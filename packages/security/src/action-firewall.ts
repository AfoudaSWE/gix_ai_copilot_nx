import type { ActionRequest } from './action-request.js';
import type { ActionDecision } from './action-decision.js';
import type { SecurityContext } from './identity.js';
import type { AuditSink, AuditRecord } from './audit.js';
import { hasAllPermissions } from './permissions.js';
import type { RolePermissionMap } from './permissions.js';
import { evaluatePolicies } from './policy.js';
import type { PolicyRegistry } from './policy.js';
import { createDefaultRiskPolicy, strongerApprovalLevel } from './risk.js';
import type { ToolApprovalLevel } from '@gixcopilot/protocol';
import type { RiskPolicy } from './risk.js';
import type { RateLimiter } from './rate-limit.js';

/** Safe timings only; applications can bridge these to their OpenTelemetry tracer. */
export interface SecurityTelemetryEvent {
  readonly stage: 'firewall' | 'policy' | 'audit';
  readonly action: string;
  readonly durationMs: number;
  readonly runId?: string;
  readonly policyId?: string;
}

export interface CreateActionFirewallOptions {
  readonly onTelemetry?: (event: SecurityTelemetryEvent) => void;
  readonly policies?: PolicyRegistry;
  readonly audit?: AuditSink;
  readonly roleMap?: RolePermissionMap;
  readonly riskPolicy?: RiskPolicy;
  /**
   * Consulted with `key = "${identity.subject}:${action}"` (Section 68-69) - per-identity,
   * per the security skill's "rate limiting applies per user/tenant/API key." A
   * `createFixedWindowRateLimiter` rule map should be keyed the same way (or supply a custom
   * `RateLimiter` for a different scoping strategy, e.g. per-tenant).
   */
  readonly rateLimiter?: RateLimiter;
  /** Injected `services` made available to every policy's `PolicyContext.services` (Section 60). */
  readonly services?: Readonly<Record<string, unknown>>;
  readonly now?: () => Date;
}

/**
 * The central abstraction (Section 9, 132). `evaluate()` is pure with respect to approval
 * state - it never itself creates an `ApprovalRequest` in an `ApprovalStore`; the caller
 * (typically `@gixcopilot/server`'s tool-calling executor) does that when it sees a
 * `'approval'` decision, then calls `evaluate()` again after a human decision to re-
 * authorize before executing (Section 39, 42, 44 - "security MUST be re-evaluated before
 * execution," which calling this same pure function again satisfies directly, with no
 * separate `revalidate` method needed).
 */
export interface ActionFirewall {
  evaluate(request: ActionRequest, context: SecurityContext): Promise<ActionDecision>;
  /** Correlated lifecycle audit using the same sink/failure policy as evaluation. */
  record?(record: AuditRecord): Promise<void>;
}

function auditActorOf(context: SecurityContext): { kind: 'user' | 'system'; subject?: string } {
  return context.identity ? { kind: 'user', subject: context.identity.subject } : { kind: 'system' };
}

/**
 * Builds the mandatory pipeline (Section 26, the action-firewall skill's nine stages, adapted
 * to this codebase's existing Tool Runtime): Authentication -> RBAC -> ABAC/Business Policy ->
 * Rate Limit -> Risk/Approval, with an audit record written for every decision outcome
 * (Section 63's "not only after [a failure]"). Schema validation is deliberately NOT
 * duplicated here - Section 59's own action-firewall skill requires reusing the tool-system
 * validation rather than a second, divergent implementation, and `@gixcopilot/tools`'
 * `ToolRuntime` already performs it for every backend call immediately after this firewall
 * allows one through (see Phase_7_Decisions.md for the full ordering rationale). Every stage
 * fails closed (Section 27): a policy that throws, or a decision this firewall cannot make
 * confidently, denies rather than allows.
 */
export function createActionFirewall(options: CreateActionFirewallOptions = {}): ActionFirewall {
  const riskPolicy = options.riskPolicy ?? createDefaultRiskPolicy();
  const now = options.now ?? (() => new Date());

  function telemetry(event: SecurityTelemetryEvent): void {
    try { options.onTelemetry?.(event); } catch { /* Diagnostic observers cannot change authorization. */ }
  }
  async function record(record: AuditRecord): Promise<void> {
    const start = performance.now();
    try { await options.audit?.write(record); }
    finally { telemetry({ stage: 'audit', action: record.action, runId: record.runId, durationMs: performance.now() - start }); }
  }

  async function audit(
    request: ActionRequest,
    context: SecurityContext,
    decision: ActionDecision,
  ): Promise<void> {
    if (!options.audit) return;
    await record({
      id: globalThis.crypto.randomUUID(),
      timestamp: now().toISOString(),
      tenantId: context.tenant?.tenantId,
      actor: auditActorOf(context),
      action: request.action,
      tool: request.metadata.toolName,
      runId: request.runId,
      toolCallId: request.toolCallId,
      decision: decision.decision,
      resultStatus: decision.decision === 'deny' ? 'denied' : decision.decision === 'approval' ? 'pending' : undefined,
      metadata:
        decision.decision === 'deny'
          ? { code: decision.reason.code }
          : decision.decision === 'approval'
            ? { level: decision.approval.level }
            : undefined,
    });
  }

  const firewall: ActionFirewall = {
    record,
    async evaluate(request, context) {
      let decision: ActionDecision;
      let policyApproval: ToolApprovalLevel = 'none';

      if (!context.identity) {
        decision = {
          decision: 'deny',
          reason: { code: 'AUTHENTICATION_REQUIRED', message: 'An authenticated identity is required.' },
        };
        await audit(request, context, decision);
        return decision;
      }

      const required = request.metadata.requiredPermissions ?? [];
      if (!hasAllPermissions(context.identity, required, options.roleMap)) {
        decision = {
          decision: 'deny',
          reason: {
            code: 'PERMISSION_DENIED',
            message: 'You do not have permission to perform this action.',
          },
        };
        await audit(request, context, decision);
        return decision;
      }

      if (options.rateLimiter && !request.revalidation) {
        const key = context.tenant
          ? JSON.stringify([context.tenant.tenantId, context.identity.subject, request.action])
          : `${context.identity.subject}:${request.action}`;
        const rate = options.rateLimiter.consume(key, 1, now().getTime());
        if (!rate.allowed) {
          decision = {
            decision: 'deny',
            reason: { code: 'RATE_LIMITED', message: 'Rate limit exceeded for this action.' },
          };
          await audit(request, context, decision);
          return decision;
        }
      }

      if (options.policies) {
        const applicable = options.policies.list(request.action);
        const result = await evaluatePolicies(applicable, {
          identity: context.identity,
          tenant: context.tenant,
          action: request.action,
          input: request.arguments,
          services: options.services,
        }, (policyId, durationMs) => telemetry({ stage: 'policy', action: request.action, runId: request.runId, policyId, durationMs }));
        if (!result.allowed) {
          decision = { decision: 'deny', reason: { code: result.code, message: result.reason } };
          await audit(request, context, decision);
          return decision;
        }
        policyApproval = result.approval ?? 'none';
      }

      const approvalLevel = strongerApprovalLevel(policyApproval, riskPolicy.resolveApprovalLevel({
        risk: request.metadata.risk,
        reversibility: request.metadata.reversibility,
        explicitApproval: request.metadata.approval,
      }));

      if (approvalLevel === 'none') {
        decision = { decision: 'allow' };
        await audit(request, context, decision);
        return decision;
      }

      decision = { decision: 'approval', approval: { level: approvalLevel } };
      await audit(request, context, decision);
      return decision;
    },
  };
  return {
    record,
    async evaluate(request, context) {
      const start = performance.now();
      try { return await firewall.evaluate(request, context); }
      finally { telemetry({ stage: 'firewall', action: request.action, runId: request.runId, durationMs: performance.now() - start }); }
    },
  };
}
