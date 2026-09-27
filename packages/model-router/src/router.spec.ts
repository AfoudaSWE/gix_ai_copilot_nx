import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createCopilot } from '@gixcopilot/node';
import { createModelRuntime } from '@gixcopilot/provider';
import type { ModelProvider, ModelStreamEvent } from '@gixcopilot/provider';
import { createMockProvider } from '@gixcopilot/provider-mock';
import { createActionFirewall, createInMemoryAuditSink, createStaticAuthenticationAdapter } from '@gixcopilot/security';
import { defineTool } from '@gixcopilot/tools';
import { createModelRouter, createProviderHealth, createRoutedModelRuntime, isFallbackEligible } from './index.js';
import type { ModelCatalogEntry, RoutingDecisionEvent } from './index.js';

const caps = { streaming: true, tools: true, structuredOutput: false, vision: false, contextWindow: 128_000 };
const catalog: ModelCatalogEntry[] = [
  { provider: 'primary', model: 'large', capabilities: caps, tier: 'premium' },
  { provider: 'backup', model: 'medium', capabilities: caps, tier: 'standard' },
  { provider: 'local', model: 'small', capabilities: { ...caps, tools: false, contextWindow: 8_000 }, tier: 'economy' },
];
const user = (text: string) => [{ role: 'user' as const, content: [{ type: 'text' as const, text }] }];

/** Wraps a provider to count calls - proves which models were (not) called. */
function counted(provider: ModelProvider): ModelProvider & { calls: () => number } {
  let calls = 0;
  return {
    id: provider.id,
    stream(request, options) {
      calls += 1;
      return provider.stream(request, options);
    },
    calls: () => calls,
  };
}

async function collect(stream: AsyncIterable<ModelStreamEvent>): Promise<ModelStreamEvent[]> {
  const events: ModelStreamEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

describe('model router', () => {
  it('routes deterministically for fixed, fallback, capability and policy strategies', async () => {
    const fixed = createModelRouter({ catalog, strategy: { type: 'fixed', model: { provider: 'backup', model: 'medium' } } });
    expect((await fixed.select({})).primary).toEqual({ provider: 'backup', model: 'medium' });

    const chain = createModelRouter({ catalog, strategy: { type: 'fallback', chain: catalog } });
    expect(await chain.select({})).toMatchObject({ primary: { provider: 'primary' }, fallbacks: [{ provider: 'backup' }, { provider: 'local' }], strategy: 'fallback' });
    // Capability requirements remove models that cannot serve the request.
    expect((await chain.select({ requires: { tools: true } })).fallbacks).toEqual([{ provider: 'backup', model: 'medium' }]);
    expect((await chain.select({ minContextWindow: 100_000 })).fallbacks.map((model) => model.provider)).toEqual(['backup']);
    await expect(chain.select({ requires: { vision: true } })).rejects.toThrow(/No configured model/);

    const policy = createModelRouter({
      catalog,
      strategy: { type: 'policy', rules: [{ when: { tenantId: 'budget-tenant' }, models: [{ provider: 'local', model: 'small' }] }], default: [{ provider: 'primary', model: 'large' }] },
    });
    expect((await policy.select({ tenantId: 'budget-tenant' })).primary.provider).toBe('local');
    expect((await policy.select({ tenantId: 'other' })).primary.provider).toBe('primary');

    // A requested model is honored only if it is in the catalog.
    expect((await chain.select({ requested: { provider: 'backup', model: 'medium' } })).primary.provider).toBe('backup');
    expect((await chain.select({ requested: { provider: 'evil', model: 'unlisted' } })).primary.provider).toBe('primary');
    // Cheaper routing happens only when a policy explicitly asks for it.
    expect((await chain.select({ preferTier: 'standard' })).primary.provider).toBe('backup');
    expect((await chain.select({})).primary.provider).toBe('primary');
  });

  it('health is per model and needs several failures; unhealthy models move behind healthy ones', async () => {
    let now = 0;
    const health = createProviderHealth({ minSamples: 3, failureRatio: 0.5, cooldownMs: 1000, now: () => now });
    const large = { provider: 'primary', model: 'large' };
    health.record(large, 'failure');
    expect(health.isAvailable(large)).toBe(true);
    health.record(large, 'timeout');
    health.record(large, 'rate_limited');
    expect(health.isAvailable(large)).toBe(false);
    expect(health.isAvailable({ provider: 'primary', model: 'other' })).toBe(true);
    const router = createModelRouter({ catalog, strategy: { type: 'fallback', chain: catalog }, health });
    const route = await router.select({});
    expect(route.primary.provider).toBe('backup');
    expect(route.fallbacks[0]?.provider).toBe('local');
    expect(route.fallbacks.at(-1)?.provider).toBe('primary');
    now = 1000;
    expect(health.isAvailable(large)).toBe(true);
  });

  it('classifies which errors may fall back', () => {
    expect(isFallbackEligible({ code: 'RATE_LIMITED', message: '', retryable: true })).toBe(true);
    expect(isFallbackEligible({ code: 'NETWORK_ERROR', message: '', retryable: true })).toBe(true);
    expect(isFallbackEligible({ code: 'PROVIDER_ERROR', message: '', retryable: true })).toBe(true);
    for (const code of ['VALIDATION_ERROR', 'AUTHENTICATION_ERROR', 'CANCELLED', 'PERMISSION_DENIED', 'POLICY_DENIED', 'TOOL_OUTPUT_INVALID', 'CONTEXT_LIMIT_EXCEEDED']) {
      expect(isFallbackEligible({ code: code as Parameters<typeof isFallbackEligible>[0]['code'], message: '', retryable: true })).toBe(false);
    }
    expect(isFallbackEligible({ code: 'PROVIDER_ERROR', message: '', retryable: false })).toBe(false);
  });

  it('Section 183: a retryable primary failure falls back and succeeds', async () => {
    const primary = counted(createMockProvider({ id: 'primary', scenario: { failBeforeFirstChunk: { code: 'RATE_LIMITED', message: '429', retryable: true } } }));
    const backup = counted(createMockProvider({ id: 'backup', scenario: { chunks: ['from', ' backup'] } }));
    const decisions: RoutingDecisionEvent[] = [];
    const runtime = createRoutedModelRuntime({
      runtime: createModelRuntime({ providers: [primary, backup], defaults: { retry: { maxAttempts: 1, baseDelayMs: 0, maxDelayMs: 0 } } }),
      router: createModelRouter({ catalog, strategy: { type: 'fallback', chain: catalog } }),
      onDecision: (event) => decisions.push(event),
    });
    const events = await collect(runtime.stream({ messages: user('hi') }));
    expect(events.filter((event) => event.type === 'content.delta').map((event) => (event.type === 'content.delta' ? event.delta : '')).join('')).toBe('from backup');
    expect(events.at(-1)?.type).toBe('model.completed');
    expect([primary.calls(), backup.calls()]).toEqual([1, 1]);
    expect(decisions.map((decision) => decision.outcome)).toEqual(['selected', 'fallback']);
  });

  it('Section 184: no fallback for an invalid request, a user cancellation, or after output', async () => {
    const backup = counted(createMockProvider({ id: 'backup', scenario: { chunks: ['should not run'] } }));
    const router = createModelRouter({ catalog, strategy: { type: 'fallback', chain: catalog } });
    const run = async (primaryScenario: NonNullable<Parameters<typeof createMockProvider>[0]>['scenario'], signal?: AbortSignal) =>
      collect(
        createRoutedModelRuntime({
          runtime: createModelRuntime({ providers: [createMockProvider({ id: 'primary', scenario: primaryScenario }), backup], defaults: { retry: { maxAttempts: 1, baseDelayMs: 0, maxDelayMs: 0 } } }),
          router,
        }).stream({ messages: user('hi'), signal }),
      );

    const invalid = await run({ failBeforeFirstChunk: { code: 'VALIDATION_ERROR', message: 'bad request', retryable: false } });
    expect(invalid.at(-1)).toMatchObject({ type: 'model.failed', error: { code: 'VALIDATION_ERROR' } });

    const auth = await run({ failBeforeFirstChunk: { code: 'AUTHENTICATION_ERROR', message: 'bad key', retryable: false } });
    expect(auth.at(-1)).toMatchObject({ type: 'model.failed', error: { code: 'AUTHENTICATION_ERROR' } });

    const midStream = await run({ chunks: ['partial', ' answer', ' more'], failDuringStream: { code: 'NETWORK_ERROR', message: 'reset', retryable: true, afterChunks: 1 } });
    expect(midStream.at(-1)).toMatchObject({ type: 'model.failed', error: { code: 'NETWORK_ERROR' } });

    const controller = new AbortController();
    controller.abort();
    const cancelled = await run({ failBeforeFirstChunk: { code: 'NETWORK_ERROR', message: 'aborted', retryable: true } }, controller.signal);
    expect(cancelled.at(-1)?.type).toBe('model.failed');
    expect(backup.calls()).toBe(0);
  });

  it('Section 185: a model failure after a side-effecting tool ran never repeats the action', async () => {
    let refunds = 0;
    const audit = createInMemoryAuditSink();
    const refund = defineTool({
      name: 'payments.refund',
      description: 'Refund a payment',
      input: z.object({ paymentId: z.string() }),
      security: { risk: 'write', approval: 'none' },
      execute: ({ paymentId }) => {
        refunds += 1;
        return Promise.resolve({ refunded: paymentId });
      },
    });
    // Model A requests the refund, then fails transiently on the follow-up call.
    const primary = counted(
      createMockProvider({
        id: 'primary',
        scenario: (attempt) =>
          attempt === 1
            ? { toolCalls: [{ id: 'call-1', name: 'payments.refund', arguments: { paymentId: 'PAY-1' } }] }
            : { failBeforeFirstChunk: { code: 'PROVIDER_ERROR', message: '503', retryable: true } },
      }),
    );
    const backup = counted(createMockProvider({ id: 'backup', scenario: { chunks: ['Refund PAY-1 completed.'] } }));
    const base = createModelRuntime({ providers: [primary, backup], defaults: { retry: { maxAttempts: 1, baseDelayMs: 0, maxDelayMs: 0 } } });
    const copilot = createCopilot({
      model: { provider: 'primary', model: 'large' },
      modelRuntime: createRoutedModelRuntime({ runtime: base, router: createModelRouter({ catalog, strategy: { type: 'fallback', chain: catalog } }) }),
      tools: [refund],
      security: {
        firewall: createActionFirewall({ audit }),
        authentication: createStaticAuthenticationAdapter({ agent: { subject: 'agent-1', roles: [], permissions: [], attributes: { tenantId: 'tenant-a' } } }),
      },
    });
    try {
      const result = await copilot.run({ messages: user('Refund PAY-1'), headers: { authorization: 'Bearer agent' } });
      expect(result.status).toBe('completed');
      expect(result.text).toBe('Refund PAY-1 completed.');
      expect(refunds).toBe(1);
      expect(audit.list().filter((record) => record.decision === 'execution.completed')).toHaveLength(1);
      expect([primary.calls(), backup.calls()]).toEqual([2, 1]);
    } finally {
      await copilot.close();
    }
  });
});
