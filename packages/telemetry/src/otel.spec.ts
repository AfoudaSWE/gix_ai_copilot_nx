import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { trace } from '@opentelemetry/api';
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { createOpenTelemetryAdapter } from './otel.js';

/** One provider for the whole suite: OTel's ProxyTracer caches its first delegate (see
 * `@gixcopilot/agents`' tracing.spec.ts for the full explanation). */
describe('createOpenTelemetryAdapter', () => {
  const exporter = new InMemorySpanExporter();
  const provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });

  beforeAll(() => {
    trace.setGlobalTracerProvider(provider);
  });
  afterEach(() => {
    exporter.reset();
  });
  afterAll(async () => {
    await provider.shutdown();
    trace.disable();
  });

  it('exports correctly nested spans with correlation attributes and error status', async () => {
    const telemetry = createOpenTelemetryAdapter();
    const root = telemetry.startSpan('copilot.run', { correlation: { runId: 'run-1', threadId: 't-1' } });
    const child = telemetry.startSpan('tool.execute', { parent: root, attributes: { 'copilot.tool_name': 'applications.get' } });
    child.end('error', new Error('denied'));
    root.end('ok');
    await provider.forceFlush();

    const spans = exporter.getFinishedSpans();
    const rootSpan = spans.find((span) => span.name === 'copilot.run');
    const childSpan = spans.find((span) => span.name === 'tool.execute');
    expect(rootSpan?.attributes['copilot.run_id']).toBe('run-1');
    expect(rootSpan?.attributes['copilot.thread_id']).toBe('t-1');
    expect(childSpan?.parentSpanId).toBe(rootSpan?.spanContext().spanId);
    expect(childSpan?.attributes['copilot.tool_name']).toBe('applications.get');
    expect(childSpan?.status.code).toBe(2); // SpanStatusCode.ERROR
    expect(childSpan?.events.some((event) => event.name === 'exception')).toBe(true);
  });

  it('head sampling drops an unsampled root and its whole subtree', async () => {
    const telemetry = createOpenTelemetryAdapter({ shouldSample: (name) => name !== 'copilot.run' });
    const root = telemetry.startSpan('copilot.run');
    telemetry.startSpan('model.call', { parent: root }).end();
    root.end();
    telemetry.startSpan('workflow.run').end();
    await provider.forceFlush();
    expect(exporter.getFinishedSpans().map((span) => span.name)).toEqual(['workflow.run']);
  });

  it("'off' mode reports enabled: false", () => {
    expect(createOpenTelemetryAdapter({ mode: 'off' }).enabled).toBe(false);
  });

  it('records metrics through the meter API without throwing when no meter provider is registered', () => {
    const telemetry = createOpenTelemetryAdapter();
    expect(() => {
      telemetry.recordMetric({ name: 'copilot.runs', kind: 'counter', value: 1, attributes: {} });
      telemetry.recordMetric({ name: 'copilot.model.latency_ms', kind: 'histogram', value: 12, attributes: {} });
      telemetry.recordMetric({ name: 'copilot.active', kind: 'gauge', value: 3, attributes: {} });
      telemetry.recordMetric({ name: 'copilot.active', kind: 'gauge', value: 1, attributes: {} });
    }).not.toThrow();
  });
});
