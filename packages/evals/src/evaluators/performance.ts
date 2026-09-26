import type { Evaluator } from '../types.js';
import { defineEvaluator, result, skipped } from './common.js';

/** Section 117: total and first-token latency; a case budget fails only when one is set. */
export function latencyEvaluator(): Evaluator {
  const self = { id: 'latency', metric: 'latency_ms' };
  return defineEvaluator({
    ...self,
    evaluate({ evalCase, record }) {
      const budget = evalCase.expected?.maxLatencyMs;
      return result(self, {
        value: record.latencyMs,
        unit: 'ms',
        threshold: budget,
        passed: budget === undefined ? undefined : record.latencyMs <= budget,
        evidence: [`total ${record.latencyMs}ms`, ...(record.timeToFirstTokenMs !== undefined ? [`first token ${record.timeToFirstTokenMs}ms`] : [])],
        details: { timeToFirstTokenMs: record.timeToFirstTokenMs, modelLatencyMs: record.modelCalls.map((call) => call.latencyMs) },
      });
    },
  });
}

/** Section 118: tokens per run and per agent (each model call counted once). */
export function tokenEvaluator(): Evaluator {
  const self = { id: 'tokens', metric: 'total_tokens' };
  return defineEvaluator({
    ...self,
    evaluate({ evalCase, record }) {
      const budget = evalCase.expected?.maxTokens;
      return result(self, {
        value: record.usage.totalTokens,
        unit: 'tokens',
        threshold: budget,
        passed: budget === undefined ? undefined : record.usage.totalTokens <= budget,
        evidence: [`input ${record.usage.inputTokens}, output ${record.usage.outputTokens}`],
        details: { usage: record.usage, byAgent: record.usageByAgent },
      });
    },
  });
}

/** Section 119: estimated cost from CONFIGURED pricing - always labeled an estimate. */
export function costEvaluator(): Evaluator {
  const self = { id: 'cost', metric: 'estimated_cost' };
  return defineEvaluator({
    ...self,
    evaluate({ evalCase, record }) {
      if (!record.cost) return skipped(self, 'No pricing configured for this model - cost not estimated.');
      const budget = evalCase.expected?.maxCost;
      return result(self, {
        value: record.cost.amount,
        unit: 'currency',
        threshold: budget,
        passed: budget === undefined ? undefined : record.cost.amount <= budget,
        evidence: [`estimated ${record.cost.amount.toFixed(6)} ${record.cost.currency} (estimate from configured pricing${record.cost.pricing.source ? `: ${record.cost.pricing.source}` : ''})`],
        details: { estimate: true, currency: record.cost.currency },
      });
    },
  });
}

/** Section 120: model, tool, schema, security and timeout failures in the run. */
export function errorRateEvaluator(): Evaluator {
  const self = { id: 'error-rate', metric: 'error_free' };
  return defineEvaluator({
    ...self,
    evaluate({ record }) {
      const categories: Record<string, number> = {};
      const bump = (key: string): void => {
        categories[key] = (categories[key] ?? 0) + 1;
      };
      for (const call of record.modelCalls) if (call.status === 'failed') bump(call.errorCode === 'TIMEOUT' ? 'timeout' : 'model');
      for (const tool of record.tools) {
        if (tool.status !== 'failed') continue;
        if (tool.securityDecision && tool.securityDecision !== 'allow') bump('security');
        else if (tool.errorCode === 'TIMEOUT') bump('timeout');
        else if (tool.errorCode === 'VALIDATION_ERROR' || tool.errorCode === 'TOOL_OUTPUT_INVALID') bump('schema');
        else bump('tool');
      }
      if (record.status === 'failed' && record.error?.code === 'VALIDATION_ERROR') bump('schema');
      const failures = Object.values(categories).reduce((sum, count) => sum + count, 0);
      return result(self, { value: failures === 0 ? 1 : 0, evidence: Object.entries(categories).map(([key, count]) => `${key}: ${count}`), details: { categories } });
    },
  });
}
