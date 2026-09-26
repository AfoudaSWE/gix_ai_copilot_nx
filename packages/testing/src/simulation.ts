import { agentRoutingDecidedEvent, createAgentRegistry, createAgentRuntime } from '@gixcopilot/agents';
import type { AgentRouteDecision, AgentRouter, AgentRunResult, AgentRuntime, AnyAgentDefinition } from '@gixcopilot/agents';
import { EventSequencer } from '@gixcopilot/core';
import { createDevTools } from '@gixcopilot/devtools';
import type { DevToolsRecorder, DevToolsSession } from '@gixcopilot/devtools';
import type { CopilotEvent } from '@gixcopilot/protocol';
import type { ModelProvider } from '@gixcopilot/provider';
import type { SecurityContext } from '@gixcopilot/security';
import { createRecordingTelemetry, instrumentApprovalStore, recordProtocolEvent } from '@gixcopilot/telemetry';
import { createInMemoryApprovalStore } from '@gixcopilot/security';
import type { RecordingTelemetry, TelemetryMode } from '@gixcopilot/telemetry';
import type { AnyToolDefinition } from '@gixcopilot/tools';
import { createInMemoryCheckpointStore, createInlineJobExecutor, createWorkflowEngine } from '@gixcopilot/workflows';
import type { AnyWorkflowDefinition, CheckpointStore, RetryPolicy, WorkflowEngine } from '@gixcopilot/workflows';
import { createApprovalFixture } from './approvals.js';
import type { ApprovalFixture } from './approvals.js';
import type { FakeClock } from './clock.js';
import type { SecurityFixture } from './security.js';
import { createInstrumentedModelRuntime, createToolStack } from './stack.js';

export interface AgentSimulationOptions {
  readonly agents: readonly AnyAgentDefinition[];
  /** One provider per `agent.model.provider` id (e.g. `createTestModel(rules, { id })`);
   * the first is the default for agents that name none. */
  readonly models: readonly ModelProvider[];
  readonly tools?: readonly AnyToolDefinition[];
  /** Real Phase 7 discovery + firewall for this caller; omitted means an unsecured stack. */
  readonly security?: SecurityFixture;
  readonly telemetryMode?: TelemetryMode;
  readonly telemetry?: RecordingTelemetry;
  readonly toolTimeoutMs?: number;
}

export interface AgentSimulation {
  readonly runtime: AgentRuntime;
  readonly telemetry: RecordingTelemetry;
  readonly devtools: DevToolsRecorder;
  readonly events: readonly CopilotEvent[];
  run(agent: string, message: string, options?: { readonly securityContext?: SecurityContext; readonly signal?: AbortSignal }): Promise<AgentRunResult>;
  /** Routes first (Section 47-51), records the decision like any other event, then runs the
   * selected agent. The router only ever chooses among `candidates` (default: all agents). */
  routeAndRun(
    router: AgentRouter,
    message: string,
    options?: { readonly securityContext?: SecurityContext; readonly candidates?: readonly string[] },
  ): Promise<{ readonly decision: AgentRouteDecision; readonly result: AgentRunResult }>;
  /** The DevTools view of everything recorded so far (Section 23). */
  session(): DevToolsSession;
}

/**
 * Deterministic multi-agent simulation (Section 83, 192): routing, delegation, handoff,
 * parallel specialists and limits run through the REAL agent runtime, tool runtime and
 * firewall - only the models are deterministic.
 */
export function createAgentSimulation(options: AgentSimulationOptions): AgentSimulation {
  const telemetry = options.telemetry ?? createRecordingTelemetry({ mode: options.telemetryMode ?? 'development-verbose' });
  const registry = createAgentRegistry();
  for (const agent of options.agents) registry.register(agent);
  const stack = createToolStack({ tools: options.tools ?? [], security: options.security, telemetry, toolTimeoutMs: options.toolTimeoutMs });
  const runtime = createAgentRuntime({
    registry,
    modelRuntime: createInstrumentedModelRuntime(options.models, telemetry),
    toolRuntime: stack.toolRuntime,
    toolResolver: stack.resolver,
    telemetry,
  });
  const devtools = createDevTools({ source: telemetry });
  const events: CopilotEvent[] = [];
  const run: AgentSimulation['run'] = (agent, message, runOptions = {}) =>
    runtime.run({
      agent,
      input: { message },
      securityContext: runOptions.securityContext ?? options.security?.securityContext ?? {},
      signal: runOptions.signal,
      onEvent: (event) => events.push(event),
    });
  return {
    runtime,
    telemetry,
    devtools,
    events,
    run,
    async routeAndRun(router, message, routeOptions = {}) {
      const securityContext = routeOptions.securityContext ?? options.security?.securityContext ?? {};
      const candidates = routeOptions.candidates ?? options.agents.map((agent) => agent.id);
      const decision = await router.route({ input: { message }, securityContext, candidateAgentIds: candidates });
      const event = agentRoutingDecidedEvent(
        { runId: globalThis.crypto.randomUUID(), threadId: globalThis.crypto.randomUUID() },
        new EventSequencer(),
        decision.router,
        decision.agentId,
        candidates,
        decision.reasonCode,
      );
      events.push(event);
      if (telemetry.enabled) recordProtocolEvent(telemetry, event, { tenantId: securityContext.tenant?.tenantId });
      return { decision, result: await run(decision.agentId, message, { securityContext }) };
    },
    session: () => devtools.getSession(),
  };
}

export interface WorkflowSimulationOptions {
  readonly workflows: readonly AnyWorkflowDefinition[];
  readonly tools?: readonly AnyToolDefinition[];
  readonly security?: SecurityFixture;
  readonly agentRuntime?: AgentRuntime;
  readonly clock?: FakeClock;
  readonly retryPolicy?: RetryPolicy;
  readonly checkpointStore?: CheckpointStore;
  readonly telemetry?: RecordingTelemetry;
  readonly approvalExpiresInMs?: number;
}

export interface WorkflowSimulation {
  readonly engine: WorkflowEngine;
  readonly approvals: ApprovalFixture;
  readonly checkpoints: CheckpointStore;
  readonly telemetry: RecordingTelemetry;
  readonly devtools: DevToolsRecorder;
  readonly events: readonly CopilotEvent[];
  /** A second engine over the SAME persisted state - simulates a process restart (Section 198). */
  restart(): WorkflowEngine;
}

/**
 * Deterministic workflow simulation without Redis or Postgres (Section 84, 193): the real
 * engine with its in-memory checkpoint store and inline job executor, the real approval
 * store (decided only through the approval fixture), and the real tool/firewall stack.
 */
export function createWorkflowSimulation(options: WorkflowSimulationOptions): WorkflowSimulation {
  const telemetry = options.telemetry ?? createRecordingTelemetry({ mode: 'development-verbose' });
  const checkpoints = options.checkpointStore ?? createInMemoryCheckpointStore();
  // Instrumented like production, so approval lifecycle reaches DevTools and replay.
  const approvals = createApprovalFixture({ clock: options.clock, store: instrumentApprovalStore(createInMemoryApprovalStore(), telemetry) });
  const stack = createToolStack({ tools: options.tools ?? [], security: options.security, telemetry });
  const events: CopilotEvent[] = [];
  const build = (): WorkflowEngine => {
    const engine = createWorkflowEngine({
      telemetry,
      checkpointStore: checkpoints,
      jobExecutor: createInlineJobExecutor(),
      toolRuntime: stack.toolRuntime,
      agentRuntime: options.agentRuntime,
      approvals: approvals.store,
      retryPolicy: options.retryPolicy,
      approvalExpiresInMs: options.approvalExpiresInMs,
    });
    for (const workflow of options.workflows) engine.register(workflow);
    return engine;
  };
  return { engine: build(), approvals, checkpoints, telemetry, devtools: createDevTools({ source: telemetry }), events, restart: build };
}
