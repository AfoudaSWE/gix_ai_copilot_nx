import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineAgent } from '@gixcopilot/agents';
import { createDevTools, importBundle } from '@gixcopilot/devtools';
import { createRecordingTelemetry, createRetrieverTelemetry } from '@gixcopilot/telemetry';
import { defineTool } from '@gixcopilot/tools';
import type { AnyToolDefinition } from '@gixcopilot/tools';
import { approvalStep, defineWorkflow, toolStep } from '@gixcopilot/workflows';
import { createKnowledgeFixture } from './knowledge.js';
import { createTestModel } from './model.js';
import { createRecordedRetriever, createReplay, replayAgentRun, replayWorkflowRun, ReplayNotPossibleError } from './replay.js';
import { createSecurityFixture } from './security.js';
import { createAgentSimulation, createWorkflowSimulation } from './simulation.js';

/** Real, side-effecting tools whose executions are counted - the thing replay must never repeat. */
function sideEffectingTools() {
  const executed = { delete: 0, refund: 0 };
  const tools: AnyToolDefinition[] = [
    defineTool({
      name: 'applications.delete',
      description: 'Deletes an application.',
      input: z.object({ id: z.string() }),
      security: { requiredPermissions: ['applications.delete'], risk: 'destructive', approval: 'none' },
      execute: (input) => {
        executed.delete += 1;
        return Promise.resolve({ deleted: input.id });
      },
    }),
    defineTool({
      name: 'payments.refund',
      description: 'Refunds a payment.',
      input: z.object({ paymentId: z.string(), amount: z.number() }),
      security: { requiredPermissions: ['payments.refund'], risk: 'write', approval: 'none' },
      execute: (input) => {
        executed.refund += 1;
        return Promise.resolve({ refunded: input.amount, paymentId: input.paymentId });
      },
    }),
  ];
  return { tools, executed };
}

const opsAgent = defineAgent({
  id: 'ops',
  name: 'Operations',
  instructions: 'Carry out the requested operations.',
  tools: ['applications.delete', 'payments.refund'],
  model: { provider: 'ops-model', model: 'test-model' },
});

const opsModel = () =>
  createTestModel(
    [
      { when: (turn) => turn.toolResults.length >= 2, respond: { text: 'Deleted APP-1024 and refunded PAY-9.' } },
      { respond: { toolCalls: [{ name: 'applications.delete', arguments: { id: 'APP-1024' } }, { name: 'payments.refund', arguments: { paymentId: 'PAY-9', amount: 49.5 } }] } },
    ],
    { id: 'ops-model' },
  );

async function recordOriginal(mode: 'development-verbose' | 'redacted' | 'metadata-only' = 'redacted') {
  const { tools, executed } = sideEffectingTools();
  const security = createSecurityFixture({ subject: 'ops-1', tenantId: 'tenant-a', permissions: ['applications.delete', 'payments.refund'] });
  const simulation = createAgentSimulation({ agents: [opsAgent], models: [opsModel()], tools, security, telemetryMode: mode });
  const result = await simulation.run('ops', 'Delete APP-1024 and refund PAY-9.');
  return { simulation, result, executed, tools, security };
}

describe('replay never repeats side effects (Section 60-64, 186, 225 - mandatory)', () => {
  it('recorded replay serves the recorded delete and refund; the real tools do not run again', async () => {
    const original = await recordOriginal();
    expect(original.result.status).toBe('completed');
    expect(original.executed).toEqual({ delete: 1, refund: 1 });

    const replay = await replayAgentRun({
      source: original.simulation.telemetry.session(),
      agents: [opsAgent],
      agent: 'ops',
      message: 'Delete APP-1024 and refund PAY-9.',
      securityContext: original.security.securityContext,
    });

    expect(original.executed).toEqual({ delete: 1, refund: 1 }); // NO REAL DELETE, NO SECOND REFUND
    expect(replay.label).toBe('REPLAY (simulated)');
    expect(replay.result.status).toBe('completed');
    expect(replay.result.status === 'completed' && replay.result.output).toBe('Deleted APP-1024 and refunded PAY-9.');
    expect(replay.toolCalls.map((call) => [call.name, call.served])).toEqual([
      ['applications.delete', 'recorded'],
      ['payments.refund', 'recorded'],
    ]);
    expect(replay.toolSequenceMatches).toBe(true);
  });

  it('replays from an exported, re-imported debug bundle just as safely', async () => {
    const original = await recordOriginal();
    const bundle = importBundle(JSON.stringify(createDevTools({ source: original.simulation.telemetry }).exportBundle()));
    const replay = await replayAgentRun({ source: bundle.snapshot, agents: [opsAgent], agent: 'ops', message: 'Delete APP-1024 and refund PAY-9.', securityContext: original.security.securityContext });
    expect(original.executed).toEqual({ delete: 1, refund: 1 });
    expect(replay.toolCalls.every((call) => call.served === 'recorded')).toBe(true);
  });

  it('mocked and live-model replays still simulate every tool', async () => {
    const original = await recordOriginal();
    const replay = await replayAgentRun({
      source: original.simulation.telemetry.session(),
      agents: [opsAgent],
      agent: 'ops',
      message: 'Delete APP-1024 and refund PAY-9.',
      securityContext: original.security.securityContext,
      replay: { mode: 'live-model', models: [opsModel()] },
    });
    expect(replay.label).toBe('REPLAY (live model, simulated tools)');
    expect(original.executed).toEqual({ delete: 1, refund: 1 });
  });

  it('live tool re-execution needs an explicit allowlist AND still passes the firewall', async () => {
    const original = await recordOriginal();
    const noPermission = createSecurityFixture({ subject: 'intern', tenantId: 'tenant-a' });
    const replay = createReplay(original.simulation.telemetry.session(), {
      liveTools: { allow: ['applications.delete'], tools: original.tools, security: noPermission },
    });
    const simulation = createAgentSimulation({ agents: [opsAgent], models: replay.models, tools: replay.tools, security: replay.liveSecurity });
    await simulation.run('ops', 'Delete APP-1024 and refund PAY-9.');
    // The allowlisted delete was hidden/denied for a caller without the permission; the refund
    // was never allowlisted. Neither real tool ran.
    expect(original.executed).toEqual({ delete: 1, refund: 1 });
  });

  it('refuses a recorded replay when the run was recorded without payloads', async () => {
    const original = await recordOriginal('metadata-only');
    expect(() => createReplay(original.simulation.telemetry.session())).toThrow(ReplayNotPossibleError);
  });
});

describe('workflow and RAG replay foundations (Section 65, 68)', () => {
  it('a workflow replay simulates the refund step and never creates a real approval or refund', async () => {
    const { tools, executed } = sideEffectingTools();
    const State = z.object({ paymentId: z.string(), refunded: z.boolean() });
    type State = z.infer<typeof State>;
    const workflow = defineWorkflow({
      id: 'refund',
      version: '1',
      state: State,
      initialState: () => ({ paymentId: 'PAY-9', refunded: false }),
      steps: [
        approvalStep<State>({ id: 'approve', action: 'payments.refund', summary: () => 'Refund PAY-9' }),
        toolStep<State>({ id: 'refund', dependencies: ['approve'], tool: 'payments.refund', input: ({ state }) => ({ paymentId: state.paymentId, amount: 49.5 }), updateState: (state) => ({ ...state, refunded: true }) }),
      ],
    });
    const security = createSecurityFixture({ subject: 'ops-1', tenantId: 'tenant-a', permissions: ['payments.refund'] });
    const original = createWorkflowSimulation({ workflows: [workflow], tools, security });
    const started = await original.engine.start({ workflowId: 'refund', input: {}, securityContext: security.securityContext });
    await original.approvals.decideOnly(started.workflowRunId, 'approve', 'supervisor-1');
    const done = await original.engine.resume(started.workflowRunId, { securityContext: security.securityContext });
    expect(done.status).toBe('completed');
    expect(executed.refund).toBe(1);

    const replay = await replayWorkflowRun({ source: original.telemetry.session(), workflow, input: {}, securityContext: security.securityContext });
    expect(replay.checkpoint.status).toBe('completed');
    expect(replay.toolCalls).toEqual([expect.objectContaining({ name: 'payments.refund', served: 'recorded' })]);
    expect(executed.refund).toBe(1); // still one real refund
    expect(await original.approvals.pending()).toEqual([]); // no new real approval request
  });

  it('a recorded retriever returns the original retrieval, labeled as recorded', async () => {
    const knowledge = await createKnowledgeFixture({ documents: [{ id: 'application-policy', content: 'Applications are approved once identity and payment are verified.' }], tenantId: 'tenant-a' });
    const telemetry = createRecordingTelemetry({ mode: 'redacted' });
    const securityContext = createSecurityFixture({ subject: 'u', tenantId: 'tenant-a' }).securityContext;
    const live = await createRetrieverTelemetry(telemetry).instrument(knowledge.retriever).retrieve({ text: 'approval', topK: 3 }, { securityContext });
    const recorded = createRecordedRetriever(telemetry.session());
    const replayed = await recorded.retrieve({ text: 'approval' }, { securityContext });
    expect(recorded.label).toBe('recorded retrieval');
    expect(replayed.citations.map((citation) => citation.sourceId)).toEqual(live.citations.map((citation) => citation.sourceId));
  });
});
