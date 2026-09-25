import type { SpanHandle, TelemetryAdapter } from '../adapter.js';
import { ATTR, SPAN_NAMES } from '../conventions.js';
import { diagnostic } from '../diagnostics.js';
import type { ApprovalDiagnostic } from '../diagnostics.js';
import { METRICS } from '../metrics.js';

/** Structural subset of `@gixcopilot/security`'s `ApprovalRequest`/`ApprovalStore`. */
export interface ApprovalRequestLike {
  readonly approvalId: string;
  readonly actionId: string;
  readonly runId: string;
  readonly requestedBy?: string;
  readonly tenantId?: string;
  readonly approvalLevel: string;
  readonly status: string;
  readonly createdAt: string;
  readonly expiresAt?: string;
  readonly summary: string;
  readonly risk?: string;
  readonly approvals: readonly { readonly approverSubject: string; readonly at: string }[];
}

export interface ApprovalStoreLike {
  create(input: unknown, now?: Date): Promise<ApprovalRequestLike>;
  approve(approvalId: string, ...rest: unknown[]): Promise<ApprovalRequestLike>;
  reject(approvalId: string, ...rest: unknown[]): Promise<ApprovalRequestLike>;
  expire(approvalId: string, ...rest: unknown[]): Promise<ApprovalRequestLike>;
  cancel(approvalId: string): Promise<ApprovalRequestLike>;
}

/**
 * Wraps an `ApprovalStore` (Section 42, 174): `create` opens an `approval.wait` span and
 * emits a `requested` diagnostic; a decision ends the span with the real wall-clock wait
 * (Section 22's approval duration) and emits the matching diagnostic. A wait that ends in a
 * different process (a workflow resumed later) simply never ends here - the workflow
 * engine's own retroactive `workflow.approval_wait` span covers that case.
 */
export function instrumentApprovalStore<T extends ApprovalStoreLike>(
  store: T,
  telemetry: TelemetryAdapter,
  options: { readonly now?: () => number } = {},
): T {
  if (!telemetry.enabled) return store;
  const now = options.now ?? ((): number => Date.now());
  const waits = new Map<string, SpanHandle>();

  function emit(phase: ApprovalDiagnostic['phase'], request: ApprovalRequestLike, extra: Partial<ApprovalDiagnostic> = {}): void {
    telemetry.recordEvent(
      diagnostic<ApprovalDiagnostic>({
        type: 'approval',
        correlation: { runId: request.runId, tenantId: request.tenantId },
        approvalId: request.approvalId,
        action: request.actionId,
        phase,
        level: request.approvalLevel,
        status: request.status,
        requestedBy: request.requestedBy,
        risk: request.risk,
        createdAt: request.createdAt,
        expiresAt: request.expiresAt,
        summary: telemetry.redaction?.text(request.summary),
        ...extra,
      }),
    );
  }

  function settle(phase: ApprovalDiagnostic['phase'], request: ApprovalRequestLike): void {
    const span = waits.get(request.approvalId);
    waits.delete(request.approvalId);
    const waitMs = Math.max(0, now() - new Date(request.createdAt).getTime());
    span?.setAttributes({ [ATTR.status]: request.status, [ATTR.latencyMs]: waitMs });
    span?.end(phase === 'approved' ? 'ok' : 'error', phase === 'approved' ? undefined : phase);
    emit(phase, request, { waitMs, decidedBy: request.approvals.at(-1)?.approverSubject });
    telemetry.recordMetric({ name: METRICS.approvalWaitMs, kind: 'histogram', value: waitMs, attributes: { [ATTR.status]: request.status } });
  }

  const instrumented: ApprovalStoreLike = {
    async create(input, at) {
      const request = await store.create(input, at);
      const span = telemetry.startSpan(SPAN_NAMES.approvalWait, {
        correlation: { runId: request.runId, tenantId: request.tenantId },
        startedAt: new Date(request.createdAt).getTime(),
        attributes: { [ATTR.approvalId]: request.approvalId, [ATTR.approvalLevel]: request.approvalLevel, [ATTR.toolName]: request.actionId },
      });
      waits.set(request.approvalId, span);
      emit('requested', request);
      telemetry.recordMetric({ name: METRICS.approvalRequests, kind: 'counter', value: 1, attributes: { [ATTR.approvalLevel]: request.approvalLevel } });
      return request;
    },
    async approve(approvalId, ...rest) {
      const request = await store.approve(approvalId, ...rest);
      if (request.status === 'approved') settle('approved', request);
      return request;
    },
    async reject(approvalId, ...rest) {
      const request = await store.reject(approvalId, ...rest);
      settle('rejected', request);
      return request;
    },
    async expire(approvalId, ...rest) {
      const request = await store.expire(approvalId, ...rest);
      settle('expired', request);
      return request;
    },
    async cancel(approvalId) {
      const request = await store.cancel(approvalId);
      settle('cancelled', request);
      return request;
    },
  };
  return Object.assign(Object.create(Object.getPrototypeOf(store) as object) as T, store, instrumented);
}
