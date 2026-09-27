import { afterEach, describe, expect, it } from 'vitest';
import { createCopilot } from '@gixcopilot/node';
import type { Copilot } from '@gixcopilot/node';
import { createMockProvider } from '@gixcopilot/provider-mock';
import { createMemoryRateLimiter } from '@gixcopilot/redis';
import { createStaticAuthenticationAdapter } from '@gixcopilot/security';
import type { Identity } from '@gixcopilot/security';
import { createInMemoryUsageStore, createUsageAdmission, createUsageRecorder, estimateCostMicros, formatMicros } from './index.js';
import type { BudgetPolicy, PricingTable, UsageWarning } from './index.js';

const identities: Record<string, Identity> = {
  alice: { subject: 'alice', roles: [], permissions: [], attributes: { tenantId: 'acme', projectId: 'visa', environment: 'production' } },
  bob: { subject: 'bob', roles: [], permissions: [], attributes: { tenantId: 'acme', projectId: 'visa', environment: 'production' } },
  carol: { subject: 'carol', roles: [], permissions: [], attributes: { tenantId: 'globex' } },
};
// Test pricing only - the SDK ships no prices.
const pricing: PricingTable = { version: 'test-2026-09', currency: 'USD', models: { 'main/large': { inputPerMillion: 10, outputPerMillion: 30 }, 'cheap/small': { inputPerMillion: 1, outputPerMillion: 2 } } };

const copilots: Copilot[] = [];
afterEach(async () => {
  await Promise.all(copilots.splice(0).map((copilot) => copilot.close()));
});

function setup(options: { budgets?: readonly BudgetPolicy[]; quotas?: Parameters<typeof createUsageAdmission>[0]['quotas']; rateLimits?: Parameters<typeof createUsageAdmission>[0]['rateLimits'] } = {}) {
  const store = createInMemoryUsageStore();
  const warnings: UsageWarning[] = [];
  const main = createMockProvider({ id: 'main', scenario: { chunks: ['main answer'], usage: { inputTokens: 1000, outputTokens: 500, totalTokens: 1500 } } });
  const cheap = createMockProvider({ id: 'cheap', scenario: { chunks: ['cheap answer'], usage: { inputTokens: 1000, outputTokens: 500, totalTokens: 1500 } } });
  const copilot = createCopilot({
    model: { provider: 'main', model: 'large' },
    providers: [main, cheap],
    security: { authentication: createStaticAuthenticationAdapter(identities) },
    server: {
      requireAuthentication: true,
      admission: createUsageAdmission({ store, limiter: createMemoryRateLimiter(), onWarning: (warning) => warnings.push(warning), ...options }),
      runObservers: [createUsageRecorder({ store, pricing })],
    },
  });
  copilots.push(copilot);
  const ask = (who: string) => copilot.app.inject({ method: 'POST', url: '/runs', headers: { authorization: `Bearer ${who}` }, payload: { messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }] } });
  return { store, warnings, copilot, ask };
}

describe('@gixcopilot/usage', () => {
  it('records tokens, requests and estimated cost per tenant/project/model, never across tenants', async () => {
    const { store, ask } = setup();
    expect((await ask('alice')).statusCode).toBe(200);
    expect((await ask('carol')).statusCode).toBe(200);
    const acme = await store.forTenant({ tenantId: 'acme' }).aggregate({ groupBy: ['kind', 'model', 'project'] });
    const model = acme.find((row) => row.key.kind === 'model');
    expect(model).toMatchObject({ key: { model: 'large', project: 'visa' }, totalTokens: 1500, pricedEvents: 1 });
    // 1000 * 10 + 500 * 30 = 25,000 micros = 0.025 USD, labelled as an estimate.
    expect(model?.estimatedCostMicros).toBe(25_000);
    expect(formatMicros(25_000, 'USD')).toBe('0.0250 USD (estimated)');
    expect(acme.find((row) => row.key.kind === 'request')?.count).toBe(1);
    const globex = await store.forTenant({ tenantId: 'globex' }).aggregate({ groupBy: ['kind'] });
    expect(globex.find((row) => row.key.kind === 'request')?.count).toBe(1);
    // Unpriced models produce no invented cost.
    expect(estimateCostMicros(pricing, { provider: 'unknown', model: 'x', inputTokens: 10, outputTokens: 10 })).toBeUndefined();
    expect(estimateCostMicros(undefined, { provider: 'main', model: 'large', inputTokens: 10, outputTokens: 10 })).toBeUndefined();
  });

  it('Section 187: budgets warn, then block, per configured action', async () => {
    const { warnings, ask } = setup({ budgets: [{ name: 'acme-monthly', scope: 'tenant', limitMicros: 60_000, period: 'month', warnAt: 0.5, action: 'block' }] });
    expect((await ask('alice')).statusCode).toBe(200); // 25k used
    expect(warnings).toHaveLength(0);
    expect((await ask('alice')).statusCode).toBe(200); // warned at 25k/60k? no: < 0.5
    expect((await ask('bob')).statusCode).toBe(200); // 50k used before this one -> warn
    expect(warnings.map((warning) => warning.policy)).toContain('acme-monthly');
    const blocked = await ask('alice'); // 75k >= 60k
    expect(blocked.statusCode).toBe(402);
    expect(blocked.json()).toMatchObject({ error: { code: 'BUDGET_EXCEEDED' } });
    expect(JSON.stringify(blocked.json())).not.toMatch(/redis|postgres|sql/i);
    // Another tenant is unaffected.
    expect((await ask('carol')).statusCode).toBe(200);
  });

  it('Section 187: a route-cheaper budget switches model only because the policy says so', async () => {
    const { store, ask } = setup({ budgets: [{ name: 'soft', scope: 'tenant', limitMicros: 20_000, period: 'month', action: 'route-cheaper', cheaperModel: { provider: 'cheap', model: 'small' } }] });
    const first = await ask('alice');
    expect(first.body).toContain('main answer');
    const second = await ask('alice');
    expect(second.body).toContain('cheap answer');
    const rows = await store.forTenant({ tenantId: 'acme' }).aggregate({ kinds: ['model'], groupBy: ['model'] });
    expect(rows.map((row) => row.key.model).sort()).toEqual(['large', 'small']);
  });

  it('throttle budgets apply a stricter rate once reached', async () => {
    const { ask } = setup({ budgets: [{ name: 'slow-down', scope: 'tenant', limitMicros: 1, period: 'day', action: 'throttle', throttle: { limit: 1, windowMs: 60_000 } }] });
    expect((await ask('alice')).statusCode).toBe(200);
    expect((await ask('alice')).statusCode).toBe(200);
    const throttled = await ask('alice');
    expect(throttled.statusCode).toBe(429);
    expect(throttled.json()).toMatchObject({ error: { code: 'RATE_LIMITED' } });
  });

  it('quotas (volume per period) are separate from rate limits (requests per window)', async () => {
    const quota = setup({ quotas: [{ name: 'tokens', scope: 'project', metric: 'tokens', limit: 3000, period: 'month' }] });
    expect((await quota.ask('alice')).statusCode).toBe(200);
    expect((await quota.ask('bob')).statusCode).toBe(200);
    const over = await quota.ask('alice');
    expect(over.statusCode).toBe(429);
    expect(over.json()).toMatchObject({ error: { code: 'QUOTA_EXCEEDED', metadata: { metric: 'tokens' } } });

    const rate = setup({ rateLimits: [{ name: 'per-user', scope: 'user', limit: 2, windowMs: 60_000 }] });
    expect((await rate.ask('alice')).statusCode).toBe(200);
    expect((await rate.ask('alice')).statusCode).toBe(200);
    const limited = await rate.ask('alice');
    expect(limited.statusCode).toBe(429);
    expect(limited.json()).toMatchObject({ error: { code: 'RATE_LIMITED', retryable: true } });
    expect((await rate.ask('bob')).statusCode).toBe(200);
  });

  it('refuses anonymous callers when policies exist', async () => {
    const admission = createUsageAdmission({ limiter: createMemoryRateLimiter(), rateLimits: [{ name: 'r', scope: 'tenant', limit: 5, windowMs: 1000 }] });
    const decision = await admission.admit({ securityContext: {} });
    expect(decision).toMatchObject({ ok: false, status: 401 });
    expect(() => createUsageAdmission({ quotas: [{ name: 'q', scope: 'tenant', metric: 'requests', limit: 1, period: 'day' }] })).toThrow(/usage store/);
  });
});
