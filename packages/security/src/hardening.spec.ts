import { describe, expect, it } from 'vitest';
import {
  createInMemoryApprovalStore, createFieldRedactionDataPolicy, createActionFirewall,
  createFixedWindowRateLimiter, createPolicyRegistry, definePolicy, requireApproval, deny,
} from './index.js';

describe('security lifecycle hardening', () => {
  const input = { approvalId: 'approval', actionId: 'action', runId: 'run', approvalLevel: 'two-person' as const, summary: 'Change' };
  it('does not reset a completed approval on duplicate creation', async () => {
    const store = createInMemoryApprovalStore();
    await store.create(input);
    await store.approve('approval', 'a');
    await store.approve('approval', 'b');
    expect((await store.create(input)).status).toBe('approved');
    await expect(store.create({ ...input, runId: 'different' })).rejects.toThrow();
  });
  it('rejects stale revisions atomically and already-aborted waits immediately', async () => {
    const store = createInMemoryApprovalStore();
    await store.create(input);
    const results = await Promise.allSettled([
      store.approve('approval', 'a', undefined, new Date(), 0),
      store.reject('approval', 'b', undefined, new Date(), 0),
    ]);
    expect(results.map((result) => result.status)).toEqual(['fulfilled', 'rejected']);
    expect((await store.get('approval'))?.status).toBe('partially_approved');
    await expect(store.awaitDecision('approval', { signal: AbortSignal.abort() })).rejects.toThrow();
    await store.cancel('approval');
  });
  it('redacts arrays/nested objects and completely removes secret values', () => {
    const policy = createFieldRedactionDataPolicy([{ field: 'token', classification: 'secret' }, { field: 'email', classification: 'pii' }]);
    const value = [{ nested: { token: 'do-not-show', email: 'person@example.com' } }];
    const result = policy.redact(value);
    expect(JSON.stringify(result)).not.toContain('do-not-show');
    expect(JSON.stringify(result)).not.toContain('person@example.com');
    expect(value[0]?.nested.token).toBe('do-not-show');
    expect(policy.redactText?.('Context {"token":"do-not-show"}')).toContain('[REDACTED]');
  });
  it('combines approval policies with deny precedence and does not double-charge reauthorization', async () => {
    const policies = createPolicyRegistry([definePolicy({ id: 'review', evaluate: () => requireApproval('supervisor') })]);
    const firewall = createActionFirewall({ policies, rateLimiter: createFixedWindowRateLimiter({}, { limit: 1, windowMs: 60_000 }) });
    const request = { actionId: 'a', runId: 'r', action: 'records.write', arguments: {}, metadata: { toolName: 'records.write', source: 'backend' as const, risk: 'read-only' as const } };
    const context = { identity: { subject: 'u', roles: [], permissions: [] } };
    expect(await firewall.evaluate(request, context)).toEqual({ decision: 'approval', approval: { level: 'supervisor' } });
    expect((await firewall.evaluate({ ...request, revalidation: true }, context)).decision).toBe('approval');
    policies.register(definePolicy({ id: 'block', evaluate: () => deny('Business rule denied') }));
    expect((await firewall.evaluate({ ...request, revalidation: true }, context)).decision).toBe('deny');
    expect((await firewall.evaluate(request, context)).decision).toBe('deny');
  });
});
