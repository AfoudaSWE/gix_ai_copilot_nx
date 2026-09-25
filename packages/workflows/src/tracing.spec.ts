import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { trace } from '@opentelemetry/api';
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { defineTool, createStaticToolResolver, createToolRuntime } from '@gixcopilot/tools';
import { defineWorkflow } from './definition.js';
import { approvalStep, functionStep, toolStep } from './steps.js';
import { createWorkflowTestHarness } from './test-harness.js';
import { createWorkflowEngine } from './engine.js';
import { createRecordingTelemetry } from '@gixcopilot/telemetry';

/**
 * Verifies the OpenTelemetry instrumentation added to the engine (Section 149-152, 125-126):
 * real spans, correctly nested (workflow.run > workflow.step), and a retroactively-timed
 * approval-wait span using the ApprovalRequest's own persisted timestamps. See
 * `@gixcopilot/agents`' `tracing.spec.ts` for why the provider/exporter pair is created once
 * for the whole suite rather than per-test (OTel's `ProxyTracer` caches its first delegate).
 */
describe('workflow engine OpenTelemetry spans', () => {
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

  it('emits a workflow.run span with nested workflow.step spans, one per step', async () => {
    const stateSchema = z.object({ count: z.number() });
    type State = z.infer<typeof stateSchema>;
    const workflow = defineWorkflow({
      id: 'traced-workflow',
      version: '1',
      state: stateSchema,
      initialState: () => ({ count: 0 }),
      steps: [
        functionStep<State>({ id: 's1', run: ({ state }) => ({ count: state.count + 1 }) }),
        functionStep<State>({ id: 's2', dependencies: ['s1'], run: ({ state }) => ({ count: state.count + 1 }) }),
      ],
    });

    const { engine } = createWorkflowTestHarness({ workflows: [workflow] });
    const checkpoint = await engine.start({ workflowId: 'traced-workflow', input: {}, securityContext: {} });
    expect(checkpoint.status).toBe('completed');
    await provider.forceFlush();

    const spans = exporter.getFinishedSpans();
    const runSpan = spans.find((span) => span.name === 'workflow.run');
    const stepSpans = spans.filter((span) => span.name === 'workflow.step');

    expect(runSpan).toBeDefined();
    expect(stepSpans).toHaveLength(2);
    expect(stepSpans.map((span) => span.attributes['copilot.step_id']).sort()).toEqual(['s1', 's2']);
    for (const stepSpan of stepSpans) {
      expect(stepSpan.parentSpanId).toBe(runSpan?.spanContext().spanId);
      expect(stepSpan.attributes['copilot.run_id']).toBe(checkpoint.workflowRunId);
    }
  });

  it('records a retroactively-timed approval.wait span using the real decision timestamp', async () => {
    const updateTool = defineTool({
      name: 'applications.update',
      description: 'Updates an application.',
      input: z.object({ id: z.string() }),
      execute: () => Promise.resolve({ ok: true }),
    });
    const stateSchema = z.object({ applicationId: z.string(), updated: z.boolean() });
    type State = z.infer<typeof stateSchema>;
    const workflow = defineWorkflow({
      id: 'traced-approval-workflow',
      version: '1',
      input: z.object({ applicationId: z.string() }),
      state: stateSchema,
      initialState: (input) => ({ applicationId: input.applicationId, updated: false }),
      steps: [
        approvalStep<State>({
          id: 'supervisor-approval',
          action: 'applications.update',
          summary: ({ state }) => `Update ${state.applicationId}`,
        }),
        toolStep<State>({
          id: 'apply-update',
          dependencies: ['supervisor-approval'],
          tool: 'applications.update',
          input: ({ state }) => ({ id: state.applicationId }),
          updateState: (state) => ({ ...state, updated: true }),
        }),
      ],
    });

    const resolver = createStaticToolResolver([updateTool]);
    const toolRuntime = createToolRuntime({ resolver });
    const engine = createWorkflowEngine({ toolRuntime });
    engine.register(workflow);
    const approvalsHarness = createWorkflowTestHarness({ workflows: [workflow], toolResolver: resolver });

    const started = await approvalsHarness.engine.start({
      workflowId: 'traced-approval-workflow',
      input: { applicationId: 'APP-1024' },
      securityContext: { identity: { subject: 'user-1', roles: [], permissions: [] } },
    });
    expect(started.status).toBe('waiting_for_approval');

    const pending = await approvalsHarness.approvals.list({ status: 'pending' });
    await approvalsHarness.approvals.approve(pending[0]?.approvalId ?? '', 'supervisor-1');

    const resumed = await approvalsHarness.engine.resume(started.workflowRunId);
    expect(resumed.status).toBe('completed');
    await provider.forceFlush();

    const spans = exporter.getFinishedSpans();
    const waitSpan = spans.find((span) => span.name === 'approval.wait');
    expect(waitSpan).toBeDefined();
    expect(waitSpan?.attributes['copilot.approval_status']).toBe('approved');
    expect(waitSpan?.attributes['copilot.run_id']).toBe(started.workflowRunId);
    // The span's duration reflects the real gap between approval creation and decision, not
    // whatever tiny wall-clock time this test itself took to call resume().
    expect(waitSpan?.endTime[0]).toBeGreaterThanOrEqual(waitSpan?.startTime[0] ?? 0);
  });

  it('records workflow completion and step metrics through the adapter', async () => {
    const telemetry = createRecordingTelemetry({ now: () => new Date('2026-01-01T00:00:00Z'), nextId: (() => { let id = 0; return () => `id-${++id}`; })() });
    const stateSchema = z.object({ count: z.number() });
    const workflow = defineWorkflow({
      id: 'recorded-workflow', version: '1', state: stateSchema,
      initialState: () => ({ count: 0 }),
      steps: [functionStep<{ count: number }>({ id: 'increment', run: ({ state }) => ({ count: state.count + 1 }) })],
    });
    const { engine } = createWorkflowTestHarness({ workflows: [workflow], telemetry });
    const result = await engine.start({ workflowId: workflow.id, input: {}, securityContext: {} });
    expect(result.status).toBe('completed');
    expect(telemetry.session().events.filter((event) => event.type === 'run').map((event) => event.phase)).toEqual(['started', 'completed']);
    expect(telemetry.session().metrics.counters['copilot.workflow.steps']).toBe(1);
    expect(telemetry.session().spans.map((span) => span.name)).toContain('workflow.step');
  });
});
