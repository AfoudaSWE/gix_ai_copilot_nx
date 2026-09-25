import type { TelemetryAdapter } from '../adapter.js';
import { ATTR, SPAN_NAMES } from '../conventions.js';
import { diagnostic } from '../diagnostics.js';
import type { SecurityDecisionDiagnostic, SecurityStageResult } from '../diagnostics.js';
import { METRICS } from '../metrics.js';
import { readTelemetryMetadata } from './telemetry-metadata.js';
import type { ToolCallTracker } from './tool-runtime.js';

/** Structural subsets of `@gixcopilot/security` shapes - duck-typed, never imported. */
export interface ActionRequestLike {
  readonly actionId: string;
  readonly runId: string;
  readonly toolCallId?: string;
  readonly action: string;
  readonly arguments: unknown;
  readonly revalidation?: boolean;
  readonly metadata: {
    readonly toolName?: string;
    readonly source?: string;
    readonly risk?: string;
    readonly reversibility?: string;
    readonly requiredPermissions?: readonly string[];
    readonly approval?: string;
    readonly sourceMetadata?: Readonly<Record<string, unknown>>;
  };
}

export interface SecurityContextLike {
  readonly identity?: { readonly subject: string; readonly roles: readonly string[] };
  readonly tenant?: { readonly tenantId: string };
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export type ActionDecisionLike =
  | { readonly decision: 'allow' }
  | { readonly decision: 'deny'; readonly reason: { readonly code: string; readonly message: string } }
  | { readonly decision: 'approval'; readonly approval: { readonly level: string; readonly reason?: string } };

export interface ActionFirewallLike {
  evaluate(request: ActionRequestLike, context: SecurityContextLike): Promise<ActionDecisionLike>;
}

export interface SecurityTelemetryEventLike {
  readonly stage: 'firewall' | 'policy' | 'audit';
  readonly action: string;
  readonly durationMs: number;
  readonly runId?: string;
  readonly policyId?: string;
}

export interface FirewallTelemetry {
  /** Wraps `evaluate()` in a `security.evaluate` span and emits one `security.decision`
   * diagnostic whose decision is EXACTLY the firewall's own result (Section 183) - the stage
   * trail is derived from that result's reason code, never recomputed independently. */
  instrument<T extends ActionFirewallLike>(firewall: T): T;
  /** Pass as `createActionFirewall({ onTelemetry })` to capture per-policy timings. */
  readonly onTelemetry: (event: SecurityTelemetryEventLike) => void;
}

/**
 * Derives the per-stage trail (Section 40-41) from the firewall's OWN final decision and
 * reason code. `createActionFirewall` short-circuits in a fixed order (authentication →
 * RBAC → rate limit → policy → risk/approval), so the code names exactly which stage
 * denied and every later stage was never reached ("skipped").
 */
export function deriveSecurityStages(
  decision: ActionDecisionLike,
  policyTimings: readonly { readonly policyId?: string; readonly durationMs: number }[],
): readonly SecurityStageResult[] {
  const order: SecurityStageResult['stage'][] = ['authentication', 'rbac', 'rate-limit', 'policy', 'risk', 'approval'];
  const policyStage = (outcome: SecurityStageResult['outcome'], reasonCode?: string): SecurityStageResult => ({
    stage: 'policy',
    outcome,
    reasonCode,
    durationMs: policyTimings.length ? policyTimings.reduce((total, timing) => total + timing.durationMs, 0) : undefined,
    policyId: policyTimings.length === 1 ? policyTimings[0]?.policyId : undefined,
  });

  if (decision.decision === 'allow') {
    return order.map((stage) => (stage === 'policy' ? policyStage('allow') : { stage, outcome: 'allow' as const }));
  }
  if (decision.decision === 'approval') {
    return order.map((stage) =>
      stage === 'approval'
        ? { stage, outcome: 'required' as const, reasonCode: decision.approval.level }
        : stage === 'policy'
          ? policyStage('allow')
          : { stage, outcome: 'allow' as const },
    );
  }
  const code = decision.reason.code;
  const deniedAt: SecurityStageResult['stage'] =
    code === 'AUTHENTICATION_REQUIRED'
      ? 'authentication'
      : code === 'PERMISSION_DENIED'
        ? 'rbac'
        : code === 'RATE_LIMITED'
          ? 'rate-limit'
          : 'policy';
  const deniedIndex = order.indexOf(deniedAt);
  return order.map((stage, index) => {
    if (index < deniedIndex) return stage === 'policy' ? policyStage('allow') : { stage, outcome: 'allow' as const };
    if (index === deniedIndex) return stage === 'policy' ? policyStage('deny', code) : { stage, outcome: 'deny' as const, reasonCode: code };
    return { stage, outcome: 'skipped' as const };
  });
}

export function createFirewallTelemetry(
  telemetry: TelemetryAdapter,
  options: { readonly tracker?: ToolCallTracker; readonly now?: () => number } = {},
): FirewallTelemetry {
  const now = options.now ?? ((): number => Date.now());
  const policyTimings = new Map<string, { policyId?: string; durationMs: number }[]>();

  return {
    onTelemetry: (event) => {
      if (event.stage === 'policy') {
        const key = `${event.runId ?? ''}:${event.action}`;
        const list = policyTimings.get(key) ?? [];
        list.push({ policyId: event.policyId, durationMs: event.durationMs });
        policyTimings.set(key, list);
      }
    },
    instrument<T extends ActionFirewallLike>(firewall: T): T {
      if (!telemetry.enabled) return firewall;
      const instrumented: ActionFirewallLike = {
        async evaluate(request, context) {
          const meta = readTelemetryMetadata(context.metadata);
          const startedAt = now();
          const correlation = { runId: request.runId, tenantId: context.tenant?.tenantId, ...meta?.correlation };
          const span = telemetry.startSpan(SPAN_NAMES.securityEvaluate, {
            parent: meta?.parentSpan,
            correlation,
            startedAt,
            attributes: { [ATTR.toolName]: request.action, [ATTR.toolCallId]: request.toolCallId },
          });
          const timingKey = `${request.runId}:${request.action}`;
          policyTimings.delete(timingKey);
          let decision: ActionDecisionLike;
          try {
            decision = await firewall.evaluate(request, context);
          } catch (error) {
            span.end('error', error);
            throw error;
          }
          const durationMs = now() - startedAt;
          const timings = policyTimings.get(timingKey) ?? [];
          policyTimings.delete(timingKey);
          const reasonCode = decision.decision === 'deny' ? decision.reason.code : undefined;
          const approvalLevel = decision.decision === 'approval' ? decision.approval.level : undefined;
          span.setAttributes({
            [ATTR.securityDecision]: decision.decision,
            [ATTR.securityReasonCode]: reasonCode,
            [ATTR.approvalLevel]: approvalLevel,
            [ATTR.approvalRequired]: decision.decision === 'approval',
            [ATTR.latencyMs]: durationMs,
          });
          span.end('ok');

          if (request.toolCallId && options.tracker) {
            options.tracker.mark(request.toolCallId, 'authorization', now());
            options.tracker.security(request.toolCallId, { decision: decision.decision, reasonCode, approvalLevel });
            options.tracker.source(request.toolCallId, request.metadata.source);
          }

          telemetry.recordEvent(
            diagnostic<SecurityDecisionDiagnostic>({
              type: 'security.decision',
              correlation: { ...correlation, traceId: span.traceId, spanId: span.spanId, parentSpanId: span.parentSpanId },
              actionId: request.actionId,
              action: request.action,
              toolCallId: request.toolCallId,
              decision: decision.decision,
              reasonCode,
              reasonMessage: decision.decision === 'deny' ? decision.reason.message : decision.decision === 'approval' ? decision.approval.reason : undefined,
              approvalLevel,
              risk: request.metadata.risk,
              reversibility: request.metadata.reversibility,
              requiredPermissions: request.metadata.requiredPermissions,
              subject: context.identity?.subject,
              roles: context.identity?.roles,
              source: request.metadata.source,
              stages: deriveSecurityStages(decision, timings),
              durationMs,
              revalidation: request.revalidation,
            }),
          );
          telemetry.recordMetric({
            name: METRICS.securityDecisions,
            kind: 'counter',
            value: 1,
            attributes: { [ATTR.securityDecision]: decision.decision, [ATTR.securityReasonCode]: reasonCode ?? 'none' },
          });
          return decision;
        },
      };
      return Object.assign(Object.create(Object.getPrototypeOf(firewall) as object) as T, firewall, instrumented);
    },
  };
}
