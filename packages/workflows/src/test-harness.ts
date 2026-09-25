import { createStaticToolResolver, createToolRuntime } from '@gixcopilot/tools';
import type { AnyToolDefinition, ToolResolver, ToolRuntime, ToolRuntimeMiddleware } from '@gixcopilot/tools';
import { createInMemoryApprovalStore } from '@gixcopilot/security';
import type { ApprovalStore } from '@gixcopilot/security';
import type { AgentRuntime } from '@gixcopilot/agents';
import type { TelemetryAdapter } from '@gixcopilot/telemetry';
import { createInMemoryCheckpointStore } from './checkpoint.js';
import type { CheckpointStore } from './checkpoint.js';
import { createInlineJobExecutor } from './jobs.js';
import { createWorkflowEngine } from './engine.js';
import type { WorkflowEngine } from './engine.js';
import type { AnyWorkflowDefinition } from './definition.js';
import type { RetryPolicy } from './retry.js';

export interface CreateWorkflowTestHarnessOptions {
  readonly workflows: readonly AnyWorkflowDefinition[];
  readonly tools?: readonly AnyToolDefinition[];
  readonly toolResolver?: ToolResolver;
  readonly toolMiddleware?: readonly ToolRuntimeMiddleware[];
  readonly agentRuntime?: AgentRuntime;
  readonly checkpointStore?: CheckpointStore;
  readonly retryPolicy?: RetryPolicy;
  readonly telemetry?: TelemetryAdapter;
}

export interface WorkflowTestHarness {
  readonly engine: WorkflowEngine;
  readonly toolRuntime: ToolRuntime;
  readonly approvals: ApprovalStore;
  readonly checkpointStore: CheckpointStore;
}

/**
 * A zero-Redis, zero-Postgres test rig (Section 233): the in-memory checkpoint store and the
 * inline job executor are real implementations of the same ports `@gixcopilot/jobs`/
 * `@gixcopilot/checkpoint-postgres` implement for production, not mocks - a workflow test
 * exercises the actual engine logic, only swapping the durability backend.
 */
export function createWorkflowTestHarness(options: CreateWorkflowTestHarnessOptions): WorkflowTestHarness {
  const resolver = options.toolResolver ?? createStaticToolResolver(options.tools ?? []);
  const toolRuntime = createToolRuntime({ resolver, middleware: options.toolMiddleware });
  const approvals = createInMemoryApprovalStore();
  const checkpointStore = options.checkpointStore ?? createInMemoryCheckpointStore();

  const engine = createWorkflowEngine({
    checkpointStore,
    jobExecutor: createInlineJobExecutor(),
    toolRuntime,
    agentRuntime: options.agentRuntime,
    approvals,
    retryPolicy: options.retryPolicy,
    telemetry: options.telemetry,
  });
  for (const workflow of options.workflows) engine.register(workflow);

  return { engine, toolRuntime, approvals, checkpointStore };
}
