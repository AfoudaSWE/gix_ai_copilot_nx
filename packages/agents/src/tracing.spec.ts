import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { trace } from '@opentelemetry/api';
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { defineTool } from '@gixcopilot/tools';
import { createOpenTelemetryAdapter, createRecordingTelemetry } from '@gixcopilot/telemetry';
import { defineAgent } from './definition.js';
import { createAgentTestHarness } from './test-harness.js';

const ANONYMOUS = {};

/**
 * Verifies the OpenTelemetry instrumentation added to the runtime (Section 149-152): real
 * spans, correctly nested, carrying the run correlation id as a standard attribute.
 *
 * The provider/exporter pair is created exactly ONCE for the whole suite (`beforeAll`), not
 * per-test: `@opentelemetry/api`'s `ProxyTracer` (what `tracing.ts`'s module-load-time
 * `trace.getTracer(...)` returns) permanently caches the first real delegate tracer it
 * resolves and never re-resolves it, so registering a *second* provider mid-suite would
 * silently leave every subsequent span going through the first provider's now-shut-down
 * processor. Isolation between tests instead comes from `exporter.reset()`.
 */
describe('agent runtime OpenTelemetry spans', () => {
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

  it('nests instrumented model calls under agent.run', async () => {
    const getApplication = defineTool({
      name: 'applications.get',
      description: 'Get an application by id.',
      input: z.object({ id: z.string() }),
      execute: (input) => Promise.resolve({ id: input.id, status: 'approved' }),
    });
    const applicationAgent = defineAgent({
      id: 'application',
      name: 'Application Agent',
      instructions: 'Answer using applications.get.',
      tools: ['applications.get'],
    });

    const { runtime } = createAgentTestHarness({
      agents: [applicationAgent],
      telemetry: createOpenTelemetryAdapter({ instrumentationName: '@gixcopilot/agents-test' }),
      instrumentModel: true,
      tools: [getApplication],
      modelScripts: {
        mock: {
          scenario: (attempt) =>
            attempt === 1
              ? { toolCalls: [{ id: 'call-1', name: 'applications.get', arguments: { id: 'APP-1024' } }] }
              : { chunks: ['APP-1024 is approved.'] },
        },
      },
    });

    const result = await runtime.run({
      agent: 'application',
      input: { message: 'Check APP-1024' },
      securityContext: ANONYMOUS,
    });
    expect(result.status).toBe('completed');
    await provider.forceFlush();

    const spans = exporter.getFinishedSpans();
    const runSpan = spans.find((span) => span.name === 'agent.run');
    const modelCallSpans = spans.filter((span) => span.name === 'model.call');

    expect(runSpan).toBeDefined();
    expect(modelCallSpans).toHaveLength(2);

    // Every span carries the run correlation id (Section 150).
    expect(runSpan?.attributes['copilot.run_id']).toBe(result.runId);

    // Nested correctly under the run span, not siblings of it.
    for (const modelSpan of modelCallSpans) {
      expect(modelSpan.parentSpanId).toBe(runSpan?.spanContext().spanId);
    }
  });

  it('nests a delegated child run under its own agent.delegate span (Section 150)', async () => {
    const orchestrator = defineAgent({
      id: 'orchestrator',
      name: 'Orchestrator',
      instructions: 'Delegate to the specialist.',
      delegation: { delegatesTo: ['specialist'] },
      model: { provider: 'orchestrator-model', model: 'mock-model' },
    });
    const specialist = defineAgent({
      id: 'specialist',
      name: 'Specialist',
      instructions: 'Answer directly.',
      model: { provider: 'specialist-model', model: 'mock-model' },
    });

    const { runtime } = createAgentTestHarness({
      agents: [orchestrator, specialist],
      telemetry: createOpenTelemetryAdapter({ instrumentationName: '@gixcopilot/agents-test' }),
      modelScripts: {
        'orchestrator-model': {
          scenario: (attempt) =>
            attempt === 1
              ? { toolCalls: [{ id: 'd1', name: 'agent.delegate.specialist', arguments: { task: 'help' } }] }
              : { chunks: ['done'] },
        },
        'specialist-model': { scenario: { chunks: ['specialist answer'] } },
      },
    });

    await runtime.run({ agent: 'orchestrator', input: { message: 'go' }, securityContext: ANONYMOUS });
    await provider.forceFlush();

    const spans = exporter.getFinishedSpans();
    const runSpans = spans.filter((span) => span.name === 'agent.run');
    const delegationSpan = spans.find((span) => span.name === 'agent.delegate');
    expect(runSpans).toHaveLength(2);
    expect(delegationSpan).toBeDefined();

    const orchestratorRunSpan = runSpans.find((span) => span.attributes['copilot.agent_id'] === 'orchestrator');
    const specialistRunSpan = runSpans.find((span) => span.attributes['copilot.agent_id'] === 'specialist');
    expect(orchestratorRunSpan).toBeDefined();
    expect(specialistRunSpan).toBeDefined();

    // agent.delegate nests under the orchestrator's own agent.run span...
    expect(delegationSpan?.parentSpanId).toBe(orchestratorRunSpan?.spanContext().spanId);
    // ...and the specialist's own agent.run span nests under agent.delegate, not directly
    // under the orchestrator's span (Section 150's "Delegation > Child Agent Run").
    expect(specialistRunSpan?.parentSpanId).toBe(delegationSpan?.spanContext().spanId);
  });

  it('records run diagnostics and summed model usage through the adapter', async () => {
    const telemetry = createRecordingTelemetry({ now: () => new Date('2026-01-01T00:00:00Z'), nextId: (() => { let id = 0; return () => `id-${++id}`; })() });
    const agent = defineAgent({ id: 'reporter', name: 'Reporter', instructions: 'Reply directly.' });
    const { runtime } = createAgentTestHarness({
      agents: [agent],
      telemetry,
      instrumentModel: true,
      modelScripts: { mock: { scenario: { chunks: ['done'], usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 } } } },
    });
    const result = await runtime.run({ agent: 'reporter', input: 'hello', securityContext: ANONYMOUS });
    expect(result.status).toBe('completed');
    const runs = telemetry.session().events.filter((event) => event.type === 'run');
    expect(runs.map((event) => event.phase)).toEqual(['started', 'completed']);
    expect(runs[1]?.usage).toEqual({ inputTokens: 3, outputTokens: 2, totalTokens: 5 });
    expect(telemetry.session().spans.map((span) => span.name)).toContain('model.call');
  });
});
