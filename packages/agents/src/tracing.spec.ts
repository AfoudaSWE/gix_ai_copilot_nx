import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { trace } from '@opentelemetry/api';
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { defineTool } from '@gixcopilot/tools';
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

  it('emits a correctly-nested agent.run > agent.model_call > agent.tool_call span tree', async () => {
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
    const modelCallSpans = spans.filter((span) => span.name === 'agent.model_call');
    const toolCallSpan = spans.find((span) => span.name === 'agent.tool_call');

    expect(runSpan).toBeDefined();
    expect(modelCallSpans).toHaveLength(2);
    expect(toolCallSpan).toBeDefined();

    // Every span carries the run correlation id (Section 150).
    expect(runSpan?.attributes['copilot.run_id']).toBe(result.runId);
    expect(toolCallSpan?.attributes['copilot.run_id']).toBe(result.runId);
    expect(toolCallSpan?.attributes['copilot.tool_name']).toBe('applications.get');

    // Nested correctly under the run span, not siblings of it.
    expect(toolCallSpan?.parentSpanId).toBe(runSpan?.spanContext().spanId);
    for (const modelSpan of modelCallSpans) {
      expect(modelSpan.parentSpanId).toBe(runSpan?.spanContext().spanId);
    }
  });

  it('nests a delegated child run under its own agent.delegation span (Section 150)', async () => {
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
    const delegationSpan = spans.find((span) => span.name === 'agent.delegation');
    expect(runSpans).toHaveLength(2);
    expect(delegationSpan).toBeDefined();

    const orchestratorRunSpan = runSpans.find((span) => span.attributes['copilot.agent_id'] === 'orchestrator');
    const specialistRunSpan = runSpans.find((span) => span.attributes['copilot.agent_id'] === 'specialist');
    expect(orchestratorRunSpan).toBeDefined();
    expect(specialistRunSpan).toBeDefined();

    // agent.delegation nests under the orchestrator's own agent.run span...
    expect(delegationSpan?.parentSpanId).toBe(orchestratorRunSpan?.spanContext().spanId);
    // ...and the specialist's own agent.run span nests under agent.delegation, not directly
    // under the orchestrator's span (Section 150's "Delegation > Child Agent Run").
    expect(specialistRunSpan?.parentSpanId).toBe(delegationSpan?.spanContext().spanId);
  });
});
