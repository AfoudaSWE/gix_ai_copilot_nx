import { CopilotError } from '@gixcopilot/protocol';
import type { SecurityContext } from '@gixcopilot/security';
import { scopeFromSecurityContext } from '@gixcopilot/tenancy';
import type { RuntimeScope } from '@gixcopilot/tenancy';
import { periodStart } from './model.js';
import type { UsageStore } from './model.js';

/** Structurally identical to `@gixcopilot/redis`'s limiter (Redis or in-memory). */
export interface AdmissionRateLimiter {
  consume(key: string, rule: { readonly limit: number; readonly windowMs: number }, cost?: number): Promise<{ readonly allowed: boolean; readonly remaining: number; readonly resetMs: number }>;
}

export type LimitScope = 'tenant' | 'project' | 'user';

/** Requests per window (Section 75). */
export interface RateLimitPolicy {
  readonly name: string;
  readonly scope: LimitScope;
  readonly limit: number;
  readonly windowMs: number;
}

/** Volume over a calendar period (Section 77), separate from rate limits. */
export interface QuotaPolicy {
  readonly name: string;
  readonly scope: Exclude<LimitScope, 'user'>;
  readonly metric: 'tokens' | 'requests';
  readonly limit: number;
  readonly period: 'day' | 'month';
}

export type BudgetAction = 'warn' | 'throttle' | 'block' | 'route-cheaper';

/** Estimated-cost budget (Section 73-74). Every action is explicit configuration. */
export interface BudgetPolicy {
  readonly name: string;
  readonly scope: Exclude<LimitScope, 'user'>;
  readonly limitMicros: number;
  readonly period: 'day' | 'month';
  /** Emit a warning from this fraction of the budget (default 0.8). */
  readonly warnAt?: number;
  /** What happens at 100%. */
  readonly action: BudgetAction;
  /** For `route-cheaper`: the model to use once the budget is reached. */
  readonly cheaperModel?: { readonly provider: string; readonly model: string };
  /** For `throttle`: the stricter rate that applies once the budget is reached. */
  readonly throttle?: { readonly limit: number; readonly windowMs: number };
}

export interface UsageWarning {
  readonly policy: string;
  readonly kind: 'budget';
  readonly scope: RuntimeScope;
  readonly usedFraction: number;
}

export interface CreateUsageAdmissionOptions {
  readonly limiter?: AdmissionRateLimiter;
  readonly store?: UsageStore;
  readonly rateLimits?: readonly RateLimitPolicy[];
  readonly quotas?: readonly QuotaPolicy[];
  readonly budgets?: readonly BudgetPolicy[];
  /** Runs without a tenant: `reject` (default when any policy exists) or `allow`. */
  readonly anonymous?: 'reject' | 'allow';
  readonly onWarning?: (warning: UsageWarning) => void;
  readonly now?: () => Date;
}

type AdmissionResult =
  | { readonly ok: true; readonly model?: { readonly provider: string; readonly model: string } }
  | { readonly ok: false; readonly error: CopilotError; readonly status?: number };

function keyFor(scope: RuntimeScope, limitScope: LimitScope, subject: string | undefined): string | undefined {
  if (limitScope === 'tenant') return `t:${scope.tenantId}`;
  if (limitScope === 'project') return `t:${scope.tenantId}|p:${scope.projectId ?? '-'}|e:${scope.environment ?? '-'}`;
  return subject ? `t:${scope.tenantId}|u:${subject}` : undefined;
}

/**
 * The server's `admission` hook for usage policies, evaluated after authentication and before
 * any model call. Rejections are structured SDK errors (`RATE_LIMITED`, `QUOTA_EXCEEDED`,
 * `BUDGET_EXCEEDED`) whose metadata never names infrastructure. Quotas and budgets read the
 * period's recorded usage; they are checked before the request, so one in-flight request may
 * overshoot a limit by its own size.
 */
export function createUsageAdmission(options: CreateUsageAdmissionOptions) {
  const now = options.now ?? (() => new Date());
  const hasPolicies = Boolean(options.rateLimits?.length || options.quotas?.length || options.budgets?.length);
  if ((options.rateLimits?.length || options.budgets?.some((budget) => budget.action === 'throttle')) && !options.limiter) {
    throw new Error('Rate-limit and throttle policies need a limiter (createRedisRateLimiter for multiple instances).');
  }
  if ((options.quotas?.length || options.budgets?.length) && !options.store) throw new Error('Quota and budget policies need a usage store.');

  async function totals(scope: RuntimeScope, policyScope: 'tenant' | 'project', period: 'day' | 'month') {
    const store = options.store;
    if (!store) return { tokens: 0, requests: 0, costMicros: 0 };
    const narrowed: RuntimeScope = policyScope === 'tenant' ? { tenantId: scope.tenantId } : scope;
    const rows = await store.forTenant(narrowed).aggregate({ from: periodStart(period, now()).toISOString(), groupBy: ['kind'] });
    return {
      tokens: rows.find((row) => row.key.kind === 'model')?.totalTokens ?? 0,
      requests: rows.find((row) => row.key.kind === 'request')?.count ?? 0,
      costMicros: rows.reduce((sum, row) => sum + row.estimatedCostMicros, 0),
    };
  }

  return {
    async admit(info: { readonly securityContext: SecurityContext; readonly model?: { readonly provider: string; readonly model: string } }): Promise<AdmissionResult> {
      const scope = scopeFromSecurityContext(info.securityContext);
      if (!scope) {
        if (!hasPolicies || options.anonymous === 'allow') return { ok: true };
        return { ok: false, status: 401, error: CopilotError.authentication('An authenticated tenant is required.') };
      }
      const subject = info.securityContext.identity?.subject;
      let model: { readonly provider: string; readonly model: string } | undefined;

      for (const budget of options.budgets ?? []) {
        const used = (await totals(scope, budget.scope, budget.period)).costMicros;
        const fraction = budget.limitMicros <= 0 ? 1 : used / budget.limitMicros;
        if (fraction >= (budget.warnAt ?? 0.8)) options.onWarning?.({ policy: budget.name, kind: 'budget', scope, usedFraction: fraction });
        if (fraction < 1) continue;
        if (budget.action === 'block') {
          return { ok: false, status: 402, error: CopilotError.budgetExceeded(undefined, { policy: budget.name, period: budget.period }) };
        }
        if (budget.action === 'route-cheaper' && budget.cheaperModel) model = budget.cheaperModel;
        if (budget.action === 'throttle' && budget.throttle && options.limiter) {
          const key = keyFor(scope, budget.scope, subject);
          const decision = key ? await options.limiter.consume(`budget:${budget.name}:${key}`, budget.throttle) : undefined;
          if (decision && !decision.allowed) {
            return { ok: false, status: 429, error: CopilotError.rateLimited('Usage is throttled because a budget was reached.', { policy: budget.name, retryAfterMs: decision.resetMs }) };
          }
        }
      }

      for (const quota of options.quotas ?? []) {
        const used = await totals(scope, quota.scope, quota.period);
        const value = quota.metric === 'tokens' ? used.tokens : used.requests;
        if (value >= quota.limit) {
          return { ok: false, status: 429, error: CopilotError.quotaExceeded(undefined, { policy: quota.name, metric: quota.metric, period: quota.period }) };
        }
      }

      for (const rule of options.rateLimits ?? []) {
        const key = keyFor(scope, rule.scope, subject);
        if (!key || !options.limiter) continue;
        const decision = await options.limiter.consume(`rate:${rule.name}:${key}`, { limit: rule.limit, windowMs: rule.windowMs });
        if (!decision.allowed) {
          return { ok: false, status: 429, error: CopilotError.rateLimited('Too many requests.', { policy: rule.name, retryAfterMs: decision.resetMs }) };
        }
      }
      return model ? { ok: true, model } : { ok: true };
    },
  };
}
