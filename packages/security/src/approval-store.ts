import type { ToolActionPreview, ToolActionRisk, ToolActionReversibility, ToolApprovalLevel } from '@gixcopilot/protocol';
import {
  applyCancel,
  applyDecision,
  applyExpire,
  isExpired,
  isTerminal,
  requiredApproversFor,
} from './approval.js';
import type { ApprovalRequest, ApprovalStatus } from './approval.js';

/** A stale revision cannot change an approval's newer state. */
export class ApprovalConflictError extends Error {
  constructor() { super('Approval revision changed.'); this.name = 'ApprovalConflictError'; }
}

export interface CreateApprovalInput {
  readonly approvalId: string;
  readonly actionId: string;
  readonly runId: string;
  readonly toolCallId?: string;
  readonly requestedBy?: string;
  readonly tenantId?: string;
  readonly approvalLevel: ToolApprovalLevel;
  readonly summary: string;
  readonly risk?: ToolActionRisk;
  readonly reversibility?: ToolActionReversibility;
  readonly requiredPermissions?: readonly string[];
  /** Omit for no expiration (Section 41 still recommends configuring one for real deployments). */
  readonly expiresInMs?: number;
  readonly preview?: ToolActionPreview;
}

export interface ApprovalListFilter {
  readonly status?: ApprovalStatus;
  readonly runId?: string;
}

/**
 * Persisted approval lifecycle storage (Section 84). `awaitDecision` is this SDK's run-
 * pausing mechanism (Section 38-39): the tool-calling executor blocks on it exactly the way
 * it already blocks on a pending frontend tool call, so no new suspension mechanism was
 * needed anywhere else in the runtime. A future persistent (e.g. database-backed) store
 * implementing this interface across multiple processes would need a cross-process wake-up
 * mechanism (pub/sub, polling) that this in-memory implementation does not require - see
 * Phase_7_Issues.md.
 */
export interface ApprovalStore {
  create(input: CreateApprovalInput, now?: Date): Promise<ApprovalRequest>;
  get(approvalId: string): Promise<ApprovalRequest | undefined>;
  approve(approvalId: string, approverSubject: string, comment?: string, now?: Date, revision?: number): Promise<ApprovalRequest>;
  reject(approvalId: string, approverSubject: string, comment?: string, now?: Date, revision?: number): Promise<ApprovalRequest>;
  expire(approvalId: string, now?: Date): Promise<ApprovalRequest>;
  cancel(approvalId: string): Promise<ApprovalRequest>;
  list(filter?: ApprovalListFilter): Promise<readonly ApprovalRequest[]>;
  awaitDecision(approvalId: string, options?: { readonly signal?: AbortSignal }): Promise<ApprovalRequest>;
}

interface Waiter {
  readonly resolve: (request: ApprovalRequest) => void;
  readonly reject: (error: Error) => void;
}

export function createInMemoryApprovalStore(): ApprovalStore {
  const requests = new Map<string, ApprovalRequest>();
  const waiters = new Map<string, Set<Waiter>>();
  const expiryTimers = new Map<string, ReturnType<typeof setTimeout>>();

  function notify(request: ApprovalRequest): ApprovalRequest {
    const previous = requests.get(request.approvalId);
    if (previous !== request) request = { ...request, revision: (previous?.revision ?? 0) + 1 };
    requests.set(request.approvalId, request);
    if (!isTerminal(request.status)) return request;
    const timer = expiryTimers.get(request.approvalId);
    if (timer) {
      clearTimeout(timer);
      expiryTimers.delete(request.approvalId);
    }
    const pending = waiters.get(request.approvalId);
    if (!pending) return request;
    waiters.delete(request.approvalId);
    for (const waiter of pending) waiter.resolve(request);
    return request;
  }

  function scheduleExpiry(request: ApprovalRequest): void {
    if (request.expiresAt === undefined) return;
    const delay = new Date(request.expiresAt).getTime() - Date.now();
    const timer = setTimeout(
      () => {
        const current = requests.get(request.approvalId);
        if (current && !isTerminal(current.status)) {
          notify(applyExpire(current));
        }
      },
      Math.max(delay, 0),
    );
    timer.unref?.();
    expiryTimers.set(request.approvalId, timer);
  }

  function currentOf(approvalId: string, now: Date): ApprovalRequest | undefined {
    const request = requests.get(approvalId);
    if (!request) return undefined;
    if (!isTerminal(request.status) && isExpired(request, now)) {
      const expired = applyExpire(request);
      notify(expired);
      return expired;
    }
    return request;
  }

  return {
    create(input, now = new Date()) {
      const existing = requests.get(input.approvalId);
      if (existing) {
        if (existing.actionId !== input.actionId || existing.runId !== input.runId ||
            existing.tenantId !== input.tenantId || existing.requestedBy !== input.requestedBy) {
          return Promise.reject(new Error('Approval identifier already belongs to another action.'));
        }
        return Promise.resolve(existing);
      }
      const request: ApprovalRequest = {
        approvalId: input.approvalId,
        actionId: input.actionId,
        runId: input.runId,
        toolCallId: input.toolCallId,
        requestedBy: input.requestedBy,
        tenantId: input.tenantId,
        revision: 0,
        approvalLevel: input.approvalLevel,
        status: 'pending',
        createdAt: now.toISOString(),
        expiresAt: input.expiresInMs !== undefined ? new Date(now.getTime() + input.expiresInMs).toISOString() : undefined,
        summary: input.summary,
        risk: input.risk,
        reversibility: input.reversibility,
        requiredPermissions: input.requiredPermissions,
        requiredApprovers: requiredApproversFor(input.approvalLevel),
        approvals: [],
        preview: input.preview,
      };
      requests.set(request.approvalId, request);
      scheduleExpiry(request);
      return Promise.resolve(request);
    },

    get(approvalId) {
      return Promise.resolve(currentOf(approvalId, new Date()));
    },

    approve(approvalId, approverSubject, comment, now = new Date(), revision) {
      const current = currentOf(approvalId, now);
      if (!current) {
        return Promise.reject(new Error(`No approval request with id "${approvalId}".`));
      }
      if (revision !== undefined && revision !== current.revision) return Promise.reject(new ApprovalConflictError());
      const next = applyDecision(current, approverSubject, 'approve', now, comment);
      return Promise.resolve(notify(next));
    },

    reject(approvalId, approverSubject, comment, now = new Date(), revision) {
      const current = currentOf(approvalId, now);
      if (!current) {
        return Promise.reject(new Error(`No approval request with id "${approvalId}".`));
      }
      if (revision !== undefined && revision !== current.revision) return Promise.reject(new ApprovalConflictError());
      const next = applyDecision(current, approverSubject, 'reject', now, comment);
      return Promise.resolve(notify(next));
    },

    expire(approvalId, now = new Date()) {
      const current = currentOf(approvalId, now);
      if (!current) {
        return Promise.reject(new Error(`No approval request with id "${approvalId}".`));
      }
      const next = applyExpire(current);
      notify(next);
      return Promise.resolve(next);
    },

    cancel(approvalId) {
      const current = requests.get(approvalId);
      if (!current) {
        return Promise.reject(new Error(`No approval request with id "${approvalId}".`));
      }
      const next = applyCancel(current);
      notify(next);
      return Promise.resolve(next);
    },

    list(filter) {
      const all = Array.from(requests.keys()).map((id) => currentOf(id, new Date())).filter(
        (request): request is ApprovalRequest => request !== undefined,
      );
      return Promise.resolve(
        all.filter(
          (request) =>
            (filter?.status === undefined || request.status === filter.status) &&
            (filter?.runId === undefined || request.runId === filter.runId),
        ),
      );
    },

    awaitDecision(approvalId, options) {
      if (options?.signal?.aborted) return Promise.reject(new Error('Approval wait aborted.'));
      const current = currentOf(approvalId, new Date());
      if (!current) {
        return Promise.reject(new Error(`No approval request with id "${approvalId}".`));
      }
      if (isTerminal(current.status)) return Promise.resolve(current);

      return new Promise<ApprovalRequest>((resolve, reject) => {
        const waiter: Waiter = {
          resolve: (value) => { cleanup(); resolve(value); },
          reject: (error) => { cleanup(); reject(error); },
        };
        const set = waiters.get(approvalId) ?? new Set<Waiter>();
        set.add(waiter);
        waiters.set(approvalId, set);

        const onAbort = (): void => {
          set.delete(waiter);
          if (set.size === 0) waiters.delete(approvalId);
          waiter.reject(new Error('Aborted while awaiting an approval decision.'));
        };
        function cleanup(): void { options?.signal?.removeEventListener('abort', onAbort); }
        options?.signal?.addEventListener('abort', onAbort, { once: true });
      });
    },
  };
}
