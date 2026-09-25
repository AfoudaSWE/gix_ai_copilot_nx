import type { MetricRecord } from './adapter.js';
import type { AttributeValue } from './conventions.js';

/** Metric names (Section 16-22) - one vocabulary, whatever backend eventually exports them. */
export const METRICS = {
  runs: 'copilot.runs',
  modelCalls: 'copilot.model.calls',
  modelLatencyMs: 'copilot.model.latency_ms',
  modelFirstChunkMs: 'copilot.model.first_chunk_ms',
  modelRetries: 'copilot.model.retries',
  tokensInput: 'copilot.tokens.input',
  tokensOutput: 'copilot.tokens.output',
  toolCalls: 'copilot.tool.calls',
  toolLatencyMs: 'copilot.tool.latency_ms',
  agentRuns: 'copilot.agent.runs',
  agentLatencyMs: 'copilot.agent.latency_ms',
  agentIterations: 'copilot.agent.iterations',
  agentDelegations: 'copilot.agent.delegations',
  agentHandoffs: 'copilot.agent.handoffs',
  workflowRuns: 'copilot.workflow.runs',
  workflowLatencyMs: 'copilot.workflow.latency_ms',
  workflowSteps: 'copilot.workflow.steps',
  workflowRetries: 'copilot.workflow.retries',
  workflowCompensations: 'copilot.workflow.compensations',
  workflowCheckpoints: 'copilot.workflow.checkpoints',
  approvalRequests: 'copilot.approval.requests',
  approvalWaitMs: 'copilot.approval.wait_ms',
  ragRetrievals: 'copilot.rag.retrievals',
  ragLatencyMs: 'copilot.rag.latency_ms',
  ragCandidates: 'copilot.rag.candidates',
  ragIncluded: 'copilot.rag.included',
  ragCitations: 'copilot.rag.citations',
  memoryOperations: 'copilot.memory.operations',
  memoryLatencyMs: 'copilot.memory.latency_ms',
  contextResolutions: 'copilot.context.resolutions',
  contextTokens: 'copilot.context.tokens',
  securityDecisions: 'copilot.security.decisions',
  errors: 'copilot.errors',
  retries: 'copilot.retries',
  timeouts: 'copilot.timeouts',
  cancellations: 'copilot.cancellations',
} as const;

export interface HistogramSummary {
  readonly count: number;
  readonly sum: number;
  readonly min: number;
  readonly max: number;
  readonly mean: number;
  readonly p50: number;
  readonly p95: number;
  readonly p99: number;
}

export interface MetricsSummary {
  readonly counters: Readonly<Record<string, number>>;
  readonly histograms: Readonly<Record<string, HistogramSummary>>;
  readonly gauges: Readonly<Record<string, number>>;
}

export interface MetricsCollector {
  record(metric: MetricRecord): void;
  increment(name: string, attributes?: Readonly<Record<string, AttributeValue>>, by?: number): void;
  observe(name: string, value: number, attributes?: Readonly<Record<string, AttributeValue>>): void;
  gauge(name: string, value: number, attributes?: Readonly<Record<string, AttributeValue>>): void;
  summarize(): MetricsSummary;
  reset(): void;
}

function metricKey(name: string, attributes: Readonly<Record<string, AttributeValue>> | undefined): string {
  const entries = Object.entries(attributes ?? {}).sort(([a], [b]) => a.localeCompare(b));
  return entries.length === 0 ? name : `${name}{${entries.map(([key, value]) => `${key}=${String(value)}`).join(',')}}`;
}

function percentile(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1));
  return sorted[index] ?? 0;
}

export function summarizeHistogram(values: readonly number[]): HistogramSummary {
  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((total, value) => total + value, 0);
  return {
    count: sorted.length,
    sum,
    min: sorted[0] ?? 0,
    max: sorted[sorted.length - 1] ?? 0,
    mean: sorted.length === 0 ? 0 : sum / sorted.length,
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    p99: percentile(sorted, 0.99),
  };
}

/** An in-memory aggregator (Section 16, 152's "not Phase 11 dashboards" - just the numbers). */
export function createMetricsCollector(options: { readonly maxHistogramSamples?: number } = {}): MetricsCollector {
  const maxSamples = options.maxHistogramSamples ?? 10_000;
  const counters = new Map<string, number>();
  const histograms = new Map<string, number[]>();
  const gauges = new Map<string, number>();

  const collector: MetricsCollector = {
    record(metric) {
      switch (metric.kind) {
        case 'counter':
          collector.increment(metric.name, metric.attributes, metric.value);
          break;
        case 'histogram':
          collector.observe(metric.name, metric.value, metric.attributes);
          break;
        case 'gauge':
          collector.gauge(metric.name, metric.value, metric.attributes);
          break;
      }
    },
    increment(name, attributes, by = 1) {
      const key = metricKey(name, attributes);
      counters.set(key, (counters.get(key) ?? 0) + by);
    },
    observe(name, value, attributes) {
      const key = metricKey(name, attributes);
      const samples = histograms.get(key) ?? [];
      if (samples.length >= maxSamples) samples.shift();
      samples.push(value);
      histograms.set(key, samples);
    },
    gauge(name, value, attributes) {
      gauges.set(metricKey(name, attributes), value);
    },
    summarize() {
      return {
        counters: Object.fromEntries(counters),
        histograms: Object.fromEntries([...histograms.entries()].map(([key, values]) => [key, summarizeHistogram(values)])),
        gauges: Object.fromEntries(gauges),
      };
    },
    reset() {
      counters.clear();
      histograms.clear();
      gauges.clear();
    },
  };
  return collector;
}
