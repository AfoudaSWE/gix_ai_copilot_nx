import { describe, expect, it } from 'vitest';
import { createMetricsCollector, summarizeHistogram } from './metrics.js';
import { createCostEstimator, createStaticPricingTable } from './pricing.js';
import { aggregateRunTreeUsage, sumUsage } from './usage.js';

describe('createMetricsCollector', () => {
  it('aggregates counters, histograms and gauges keyed by sorted attributes', () => {
    const metrics = createMetricsCollector();
    metrics.increment('copilot.tool.calls', { status: 'ok', tool: 'a' });
    metrics.increment('copilot.tool.calls', { tool: 'a', status: 'ok' }, 2);
    metrics.observe('copilot.tool.latency_ms', 10);
    metrics.observe('copilot.tool.latency_ms', 30);
    metrics.gauge('copilot.active', 4);
    const summary = metrics.summarize();
    expect(summary.counters['copilot.tool.calls{status=ok,tool=a}']).toBe(3);
    expect(summary.histograms['copilot.tool.latency_ms']).toMatchObject({ count: 2, sum: 40, min: 10, max: 30, mean: 20 });
    expect(summary.gauges['copilot.active']).toBe(4);
  });

  it('computes percentiles', () => {
    const summary = summarizeHistogram([5, 1, 3, 2, 4, 100]);
    expect(summary.p50).toBe(3);
    expect(summary.p95).toBe(100);
    expect(summary.p99).toBe(100);
    expect(summarizeHistogram([]).count).toBe(0);
  });

  it('bounds histogram samples', () => {
    const metrics = createMetricsCollector({ maxHistogramSamples: 2 });
    for (const value of [1, 2, 3]) metrics.observe('h', value);
    expect(metrics.summarize().histograms['h']).toMatchObject({ count: 2, min: 2, max: 3 });
  });
});

describe('createCostEstimator', () => {
  it('estimates from configured pricing and labels the result as an estimate', () => {
    const estimator = createCostEstimator({
      pricing: createStaticPricingTable({ 'openai/gpt-4o-mini': { inputPerMillion: 0.15, outputPerMillion: 0.6, source: 'test table' } }),
    });
    const estimate = estimator.estimate({ inputTokens: 1_000_000, outputTokens: 500_000, totalTokens: 1_500_000 }, { provider: 'openai', model: 'gpt-4o-mini' });
    expect(estimate?.estimate).toBe(true);
    expect(estimate?.amount).toBeCloseTo(0.45);
    expect(estimate?.currency).toBe('USD');
  });

  it('returns undefined when no pricing is configured for the model - never a guessed number', () => {
    const estimator = createCostEstimator({ pricing: createStaticPricingTable({}) });
    expect(estimator.estimate({ inputTokens: 1, outputTokens: 1, totalTokens: 2 }, { provider: 'x', model: 'y' })).toBeUndefined();
    expect(estimator.estimate(undefined, { provider: 'x', model: 'y' })).toBeUndefined();
  });

  it('falls back from provider/model to */model to bare model keys', () => {
    const pricing = createStaticPricingTable({ '*/m': { inputPerMillion: 1, outputPerMillion: 1 }, plain: { inputPerMillion: 2, outputPerMillion: 2 } });
    expect(pricing('any', 'm')?.inputPerMillion).toBe(1);
    expect(pricing(undefined, 'plain')?.inputPerMillion).toBe(2);
    expect(pricing('x', 'missing')).toBeUndefined();
  });
});

describe('usage aggregation', () => {
  it('sums usage and aggregates a run tree without double counting', () => {
    expect(sumUsage([{ inputTokens: 1, outputTokens: 2, totalTokens: 3 }, undefined, { inputTokens: 4, outputTokens: 5, totalTokens: 9 }])).toEqual({
      inputTokens: 5,
      outputTokens: 7,
      totalTokens: 12,
    });
    const tree = aggregateRunTreeUsage([
      { runId: 'root', usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 } },
      { runId: 'root', usage: { inputTokens: 5, outputTokens: 5, totalTokens: 10 } },
      { runId: 'child-a', parentRunId: 'root', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } },
      { runId: 'grandchild', parentRunId: 'child-a', usage: { inputTokens: 1, outputTokens: 0, totalTokens: 1 } },
      { runId: 'child-b', parentRunId: 'root', usage: undefined },
    ]);
    expect(tree['root']?.own.totalTokens).toBe(30);
    expect(tree['root']?.total.totalTokens).toBe(33);
    expect(tree['child-a']?.total.totalTokens).toBe(3);
    expect([...tree['root']?.children ?? []].sort()).toEqual(['child-a', 'child-b']);
  });
});
