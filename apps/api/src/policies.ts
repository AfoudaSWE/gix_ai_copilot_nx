import type { ConfigSnapshot } from '@gixcopilot/management';
import type { SecurityContext } from '@gixcopilot/security';
import type { RunAdmission } from '@gixcopilot/server';
import { scopeFromSecurityContext } from '@gixcopilot/tenancy';
import type { RuntimeScope } from '@gixcopilot/tenancy';
import { createUsageAdmission } from '@gixcopilot/usage';
import type { AdmissionRateLimiter, BudgetPolicy, RateLimitPolicy, UsageStore, UsageWarning } from '@gixcopilot/usage';

/**
 * Control plane → data plane: each run's usage policies (budgets, rate limits) come from the
 * tenant's resolved config snapshot, so an admin's platform edit applies to the next run
 * without restarting servers, and never to a run already in flight.
 */
export function createSnapshotPolicyAdmission(options: {
  readonly snapshot: (scope: RuntimeScope) => Promise<{ readonly snapshot: ConfigSnapshot }>;
  readonly store: UsageStore;
  readonly limiter: AdmissionRateLimiter;
  readonly onWarning?: (warning: UsageWarning) => void;
}): RunAdmission {
  return {
    async admit(info: { readonly securityContext: SecurityContext; readonly model?: { readonly provider: string; readonly model: string } }) {
      const scope = scopeFromSecurityContext(info.securityContext);
      if (!scope) return { ok: true } as const; // authentication is enforced separately (requireAuthentication)
      const { snapshot } = await options.snapshot(scope);
      const budgets: BudgetPolicy[] = [];
      const rateLimits: RateLimitPolicy[] = [];
      for (const resource of snapshot.resources) {
        if (resource.kind === 'budget') budgets.push({ name: resource.name, ...(resource.spec as Omit<BudgetPolicy, 'name'>) });
        if (resource.kind === 'rate-limit') rateLimits.push({ name: resource.name, ...(resource.spec as Omit<RateLimitPolicy, 'name'>) });
      }
      if (budgets.length === 0 && rateLimits.length === 0) return { ok: true } as const;
      return createUsageAdmission({ store: options.store, limiter: options.limiter, budgets, rateLimits, onWarning: options.onWarning }).admit(info);
    },
  };
}
