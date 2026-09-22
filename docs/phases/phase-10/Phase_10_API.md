# Phase 10 public API

## `@gixcopilot/agents`

```ts
// Definition
defineAgent(options): AgentDefinition
isAgentEnabled(agent): boolean
assertValidAgentId(id): void
resolveAgentInstructions(agent, context): string
resolveAgentToolNames(agent, context): readonly string[]
type AgentDefinition<TInput, TOutput, TState>
type AnyAgentDefinition
type AgentInstructions<TInput>
type AgentInstructionsContext<TInput>
type AgentModelConfig
type AgentToolSelector
type AgentKnowledgeConfig
type AgentMemoryConfig
type AgentDelegationConfig      // + parallelFailurePolicy?: 'fail-fast' | 'collect-results'
type AgentMetadata
type DefineAgentOptions

// Registry
createAgentRegistry(): AgentRegistry
validateAgentGraph(...): ...
type AgentRegistry, CreateAgentRegistryOptions

// Limits
DEFAULT_AGENT_LIMITS
resolveAgentLimits(limits): Required<AgentLimits>
assertIterationLimit / assertToolCallLimit / assertDelegationLimit / assertDepthLimit
type AgentLimits

// Execution context
type AgentExecutionContext   // { runId, agentId, threadId?, rootRunId?, parentRunId?, depth, securityContext, signal, metadata? }

// Events
agentRunStartedEvent / agentRunCompletedEvent / agentRunFailedEvent / agentRunCancelledEvent
agentDelegationStartedEvent / agentDelegationCompletedEvent
agentHandoffEvent
agentRoutingDecidedEvent
type AgentEventCorrelation, AgentEventListener

// Multi-agent messages
createAgentMessageBus(): AgentMessageBus
type AgentMessage, AgentMessageBus

// Planner/executor
planSchema, planStepSchema, validatePlanStructure(...)
type Plan, PlanStep, PlanValidationError
createPlanner(options): Planner
type CreatePlannerOptions, Planner
executePlan(plan, options): Promise<PlanExecutionResult>
type ExecutePlanOptions, PlanExecutionResult, PlanStepResult

// Delegation / handoff
delegateToolName / isDelegateToolCall / parseDelegateTargetId / assertDelegationAllowed
intersectToolNames / intersectKnowledgeSources / intersectMemoryTypes
delegateModelToolDefinition
handoffToolName / isHandoffToolCall / parseHandoffTargetId / assertHandoffAllowed
handoffModelToolDefinition

// Routing
createDeterministicRouter(...): AgentRouter
createModelBasedRouter(...): AgentRouter
type AgentRouteRequest, AgentRouteDecision, AgentRouter, DeterministicRoute

// Runtime
createAgentRuntime(options: CreateAgentRuntimeOptions): AgentRuntime
type AgentRunBudget, AgentRunOptions, AgentRunResult, AgentRuntime, CreateAgentRuntimeOptions

// Test harness
createAgentTestHarness(options): AgentTestHarness
type AgentTestHarness, AgentTestModelScript, CreateAgentTestHarnessOptions
```

`AgentRunOptions` also carries three internal-use fields set automatically by delegation/
handoff dispatch — `restrictToToolNames`, `restrictToKnowledgeSources`/
`restrictToMemoryTypes`, and `otelParentContext` — never intended to be set by a fresh
top-level caller (documented inline; not hidden, since a workflow engine legitimately does
set `otelParentContext` itself for its own agent-step span nesting).

## `@gixcopilot/workflows`

```ts
// Definition
defineWorkflow(options): WorkflowDefinition
validateWorkflowGraph(definition): readonly WorkflowValidationError[]
type WorkflowDefinition, AnyWorkflowDefinition, WorkflowStep, AnyWorkflowStep
type FunctionStep, ToolStep, AgentStep, ApprovalStep, ConditionStep, ParallelStep
type WorkflowStepContext, DefineWorkflowOptions, WorkflowValidationError

// Step constructors
functionStep / toolStep / agentStep / approvalStep / conditionStep / parallelStep

// State
type WorkflowCheckpoint<TState>, WorkflowRunStatus, WorkflowStepRecord, WorkflowStepStatus

// Checkpoint store
createInMemoryCheckpointStore(): CheckpointStore
type CheckpointListFilter, CheckpointStore

// Jobs
createInlineJobExecutor(): JobExecutor
workflowStepJobId(workflowRunId, stepId, attempt): string
type JobExecutor

// Retry
DEFAULT_WORKFLOW_RETRY_POLICY
computeStepBackoffMs(policy, attempt): number
isStepErrorRetryable(error, policy): boolean
type RetryPolicy

// Compensation
buildCompensationPlan(steps, records): readonly ToolStep[]
isCompensatableStep(step): boolean

// Events
workflowRunStartedEvent / workflowRunPausedEvent / workflowRunResumedEvent /
workflowRunCompletedEvent / workflowRunFailedEvent / workflowRunCancelledEvent
workflowStepStartedEvent / workflowStepCompletedEvent / workflowStepFailedEvent
workflowCheckpointSavedEvent
type WorkflowEventCorrelation, WorkflowEventListener

// Engine
createWorkflowEngine(options: CreateWorkflowEngineOptions): WorkflowEngine
type CreateWorkflowEngineOptions, ResumeWorkflowOptions, StartWorkflowOptions, WorkflowEngine

// Test harness
createWorkflowTestHarness(options): WorkflowTestHarness
type CreateWorkflowTestHarnessOptions, WorkflowTestHarness
```

`WorkflowEngine`:

```ts
interface WorkflowEngine {
  register(definition: AnyWorkflowDefinition): void;
  unregister(workflowId: string): void;
  getDefinition(workflowId: string): AnyWorkflowDefinition | undefined;
  start<TInput>(options: StartWorkflowOptions<TInput>): Promise<WorkflowCheckpoint>;
  resume(workflowRunId: string, options?: ResumeWorkflowOptions): Promise<WorkflowCheckpoint>;
  cancel(workflowRunId: string, securityContext?: SecurityContext): Promise<WorkflowCheckpoint>;
  getCheckpoint(workflowRunId: string, securityContext?: SecurityContext): Promise<WorkflowCheckpoint | undefined>;
}
```

## `@gixcopilot/checkpoint-postgres`

```ts
createPgCheckpointStore(options: { connectionString: string; ... }): CheckpointStore
```

Implements `@gixcopilot/workflows`' own `CheckpointStore` port — no additional public
surface beyond that contract.

## `@gixcopilot/jobs`

```ts
createBullMQJobExecutor(options: CreateBullMQJobExecutorOptions): BullMQJobExecutor  // extends JobExecutor with close()
type BullMQJobExecutor, CreateBullMQJobExecutorOptions

createDeadLetterInspector(connection, queueName?): DeadLetterInspector
type DeadLetterEntry, DeadLetterInspector   // list / get / replay / discard
```

## `@gixcopilot/react` additions

```ts
useAgentRun(agentRunId: string): AgentRunState | undefined
useAgentRuns(): readonly AgentRunState[]
useAgentDelegations(): readonly AgentDelegationState[]
useAgentHandoffs(): readonly AgentHandoffState[]
useWorkflowRun(workflowRunId: string): WorkflowRunState | undefined
useWorkflowRuns(): readonly WorkflowRunState[]

type AgentRunState, AgentDelegationState, AgentHandoffState
type WorkflowRunState, WorkflowStepState
```

All six follow the exact `useSyncExternalStore` pattern `useToolCalls()`/`useApprovals()`
already use — subscribed to the same per-provider `ChatSnapshot`, cleared at the start of
every new run.

## Protocol additions (already present from the prior session, unmodified this session)

`agent.run.started/completed/failed/cancelled`, `agent.delegation.started/completed`,
`agent.handoff`, `agent.routing.decided`, `workflow.run.started/paused/resumed/completed/
failed/cancelled`, `workflow.step.started/completed/failed`, `workflow.checkpoint.saved` —
all additive `CopilotEvent` variants; `Run`/`CopilotEventBase` gained optional
`rootRunId`/`parentRunId`. See [ADR 0015](../../adr/0015-agent-and-workflow-runtime-architecture.md).
