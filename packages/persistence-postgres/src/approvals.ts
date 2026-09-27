import { and, eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { ApprovalConflictError, applyCancel, applyDecision, applyExpire, isExpired, isTerminal, requiredApproversFor } from '@gixcopilot/security';
import type { ApprovalRequest, ApprovalStore } from '@gixcopilot/security';
import { approvals } from './schema.js';

export interface CreatePostgresApprovalStoreOptions {
  /** How often `awaitDecision` re-reads the row (default 500 ms). */
  readonly pollIntervalMs?: number;
}

/**
 * Durable, multi-instance `ApprovalStore`. Same semantics as the Phase 7 in-memory store (it
 * uses the same pure transition functions), but every mutation is a row-locked transaction
 * with a revision compare-and-swap, and `awaitDecision` polls, so a decision recorded on ANY
 * server instance releases the run waiting on another. Approval still comes only from a
 * recorded human/system decision, never from model output.
 */
export function createPostgresApprovalStore(db: NodePgDatabase, options: CreatePostgresApprovalStoreOptions = {}): ApprovalStore {
  const pollMs = options.pollIntervalMs ?? 500;
  const save = async (tx: Pick<NodePgDatabase, 'update'>, request: ApprovalRequest, expectedRevision: number): Promise<ApprovalRequest> => {
    const next = { ...request, revision: expectedRevision + 1 };
    const updated = await tx
      .update(approvals)
      .set({ status: next.status, revision: next.revision, request: next, updatedAt: new Date() })
      .where(and(eq(approvals.approvalId, request.approvalId), eq(approvals.revision, expectedRevision)))
      .returning({ id: approvals.approvalId });
    if (updated.length === 0) throw new ApprovalConflictError();
    return next;
  };

  /** Locks the row, applies expiry if due, then an optional transition. */
  const mutate = async (approvalId: string, now: Date, transition?: (current: ApprovalRequest) => ApprovalRequest, expected?: number): Promise<ApprovalRequest> =>
    db.transaction(async (tx) => {
      const [row] = await tx.select().from(approvals).where(eq(approvals.approvalId, approvalId)).for('update');
      if (!row) throw new Error(`No approval request with id "${approvalId}".`);
      let current = row.request as ApprovalRequest;
      let revision = row.revision;
      if (!isTerminal(current.status) && isExpired(current, now)) {
        current = await save(tx, applyExpire(current), revision);
        revision = current.revision ?? revision + 1;
      }
      if (!transition) return current;
      if (expected !== undefined && expected !== revision) throw new ApprovalConflictError();
      return save(tx, transition(current), revision);
    });

  const store: ApprovalStore = {
    async create(input, now = new Date()) {
      const [existing] = await db.select().from(approvals).where(eq(approvals.approvalId, input.approvalId)).limit(1);
      if (existing) {
        const request = existing.request as ApprovalRequest;
        if (request.actionId !== input.actionId || request.runId !== input.runId || request.tenantId !== input.tenantId || request.requestedBy !== input.requestedBy) {
          throw new Error('Approval identifier already belongs to another action.');
        }
        return request;
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
      await db
        .insert(approvals)
        .values({ approvalId: request.approvalId, tenantId: request.tenantId ?? null, runId: request.runId, status: 'pending', revision: 0, request, expiresAt: request.expiresAt ? new Date(request.expiresAt) : null })
        .onConflictDoNothing();
      return (await store.get(request.approvalId)) ?? request;
    },
    async get(approvalId) {
      const [row] = await db.select().from(approvals).where(eq(approvals.approvalId, approvalId)).limit(1);
      if (!row) return undefined;
      const request = row.request as ApprovalRequest;
      return !isTerminal(request.status) && isExpired(request, new Date()) ? mutate(approvalId, new Date()) : request;
    },
    approve: (approvalId, approver, comment, now = new Date(), revision) => mutate(approvalId, now, (current) => applyDecision(current, approver, 'approve', now, comment), revision),
    reject: (approvalId, approver, comment, now = new Date(), revision) => mutate(approvalId, now, (current) => applyDecision(current, approver, 'reject', now, comment), revision),
    expire: (approvalId, now = new Date()) => mutate(approvalId, now, (current) => (isTerminal(current.status) ? current : applyExpire(current))),
    cancel: (approvalId) => mutate(approvalId, new Date(), (current) => applyCancel(current)),
    async list(filter) {
      const rows = await db
        .select()
        .from(approvals)
        .where(and(...(filter?.status ? [eq(approvals.status, filter.status)] : []), ...(filter?.runId ? [eq(approvals.runId, filter.runId)] : [])));
      const now = new Date();
      const result: ApprovalRequest[] = [];
      for (const row of rows) {
        const request = row.request as ApprovalRequest;
        result.push(!isTerminal(request.status) && isExpired(request, now) ? await mutate(request.approvalId, now) : request);
      }
      return result.filter((request) => filter?.status === undefined || request.status === filter.status);
    },
    async awaitDecision(approvalId, awaitOptions = {}) {
      for (;;) {
        awaitOptions.signal?.throwIfAborted();
        const current = await store.get(approvalId);
        if (!current) throw new Error(`No approval request with id "${approvalId}".`);
        if (isTerminal(current.status)) return current;
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, pollMs);
          awaitOptions.signal?.addEventListener(
            'abort',
            () => {
              clearTimeout(timer);
              reject(awaitOptions.signal?.reason instanceof Error ? awaitOptions.signal.reason : new Error('aborted'));
            },
            { once: true },
          );
        });
      }
    },
  };
  return store;
}
