import type { Identity, TenantIdentity } from './identity.js';
import type { SecurityReasonCode } from './reason-codes.js';
import type { ToolApprovalLevel } from '@gixcopilot/protocol';
import { strongerApprovalLevel } from './risk.js';

/** Everything a policy needs to evaluate one action (Section 22-23, 60). `resource` is
 * whatever domain object the policy needs to look up (a business policy may fetch it itself
 * via `services`, e.g. `services.applications.get(input.applicationId)` per Section 60's
 * example) - never assumed pre-fetched, since not every policy needs it. */
export interface PolicyContext {
  readonly identity?: Identity;
  readonly tenant?: TenantIdentity;
  readonly action: string;
  /** The model-provided arguments for this action - UNTRUSTED input (Section 5, 10). */
  readonly input: unknown;
  readonly resource?: unknown;
  /** Application services a policy may call out to (e.g. a repository lookup) - injected by
   * whoever constructs the firewall, never a global/ambient import (Section 60). */
  readonly services?: Readonly<Record<string, unknown>>;
}

export type PolicyResult =
  | { readonly allowed: true; readonly approval?: ToolApprovalLevel }
  | { readonly allowed: false; readonly reason: string; readonly code: SecurityReasonCode };

export function allow(): PolicyResult {
  return { allowed: true };
}

/** Require human review while allowing subsequent policies to deny the action. */
export function requireApproval(level: ToolApprovalLevel): PolicyResult {
  return { allowed: true, approval: level };
}

export function deny(reason: string, code: SecurityReasonCode = 'BUSINESS_RULE_DENIED'): PolicyResult {
  return { allowed: false, reason, code };
}

/**
 * A single ABAC/business rule (Section 22-23, 59-60). `appliesTo` restricts which action(s)
 * this policy is even consulted for - a policy registry only evaluates policies whose
 * `appliesTo` matches the action being evaluated (or that declare no `appliesTo`, meaning
 * "every action"). Deliberately a typed function, never a string expression evaluated via
 * `eval`/`new Function` (Section 22's explicit prohibition).
 */
export interface Policy {
  readonly id: string;
  readonly appliesTo?: string | readonly string[];
  evaluate(context: PolicyContext): Promise<PolicyResult> | PolicyResult;
}

export function definePolicy(policy: Policy): Policy {
  return policy;
}

function policyAppliesTo(policy: Policy, action: string): boolean {
  if (policy.appliesTo === undefined) return true;
  return Array.isArray(policy.appliesTo) ? policy.appliesTo.includes(action) : policy.appliesTo === action;
}

export interface PolicyRegistry {
  register(policy: Policy): void;
  unregister(id: string): void;
  list(action: string): readonly Policy[];
  all(): readonly Policy[];
}

export function createPolicyRegistry(initial: readonly Policy[] = []): PolicyRegistry {
  const policies = new Map<string, Policy>();
  for (const policy of initial) policies.set(policy.id, policy);
  return {
    register(policy) {
      policies.set(policy.id, policy);
    },
    unregister(id) {
      policies.delete(id);
    },
    list(action) {
      return Array.from(policies.values()).filter((policy) => policyAppliesTo(policy, action));
    },
    all() {
      return Array.from(policies.values());
    },
  };
}

/**
 * Runs every applicable policy and combines them with fail-closed, first-deny-wins semantics
 * (Section 26-27): if any policy denies, evaluation stops and that denial is returned; if a
 * policy throws (a genuine infrastructure failure, not a business "no"), it is treated as a
 * denial too - a policy that cannot be evaluated safely must never be treated as an implicit
 * allow.
 */
export async function evaluatePolicies(
  policies: readonly Policy[],
  context: PolicyContext,
  onEvaluated?: (policyId: string, durationMs: number) => void,
): Promise<PolicyResult> {
  let approval: ToolApprovalLevel = 'none';
  for (const policy of policies) {
    let result: PolicyResult;
    const start = performance.now();
    try {
      result = await policy.evaluate(context);
    } catch {
      return deny(
        'Security policy could not be evaluated.',
        'POLICY_DENIED',
      );
    } finally {
      try { onEvaluated?.(policy.id, performance.now() - start); } catch { /* Observer only. */ }
    }
    if (!result || typeof result.allowed !== 'boolean') return deny('Invalid security policy result.', 'POLICY_DENIED');
    if (!result.allowed) return result;
    if (result.approval) approval = strongerApprovalLevel(approval, result.approval);
  }
  return approval === 'none' ? allow() : requireApproval(approval);
}
