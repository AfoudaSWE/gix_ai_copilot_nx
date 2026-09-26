export { TestAssertionError } from './assert.js';
export { createFakeClock, createSequentialIds } from './clock.js';
export type { FakeClock } from './clock.js';

export { createTestModel, toolThenAnswer } from './model.js';
export type { TestModel, TestModelRule, TestModelResponse, TestModelTurn, TestToolCall, SimulatedFailure, CreateTestModelOptions } from './model.js';

export { createToolMocks, mockTool, expectToolCalled, expectToolNotCalled, expectToolOrder } from './tools.js';
export type { ToolMocks, ToolCallRecord, MockToolBehavior } from './tools.js';

export { createSecurityFixture, expectActionDenied, expectApprovalRequired, expectActionAllowed, expectToolUnavailable } from './security.js';
export type { SecurityFixture, SecurityFixtureOptions } from './security.js';

export { createKnowledgeFixture, expectSourceRetrieved, expectSourceNotRetrieved, expectCitation, expectAclApplied } from './knowledge.js';
export type { KnowledgeFixture, KnowledgeFixtureDocument } from './knowledge.js';

export { createMemoryFixture, expectMemoryRetrieved, expectMemoryNotRetrieved, expectMemoryWritten, expectMemoryNotWritten, expectMemoryInaccessible } from './memory.js';
export type { MemoryFixture, MemoryFixtureRecord } from './memory.js';

export { createApprovalFixture } from './approvals.js';
export type { ApprovalFixture } from './approvals.js';

export { createToolStack, createInstrumentedModelRuntime } from './stack.js';
export type { ToolStack } from './stack.js';

export { createAgentSimulation, createWorkflowSimulation } from './simulation.js';
export type { AgentSimulation, AgentSimulationOptions, WorkflowSimulation, WorkflowSimulationOptions } from './simulation.js';

export { createCopilotTestHarness } from './harness.js';
export type { CopilotTestHarness, CopilotTestHarnessOptions, CopilotTestRun } from './harness.js';

export { createReplay, replayAgentRun, replayWorkflowRun, createRecordedRetriever, ReplayNotPossibleError } from './replay.js';
export type { Replay, ReplayMode, ReplayOptions, ReplayedToolCall, LiveToolOptIn, RecordedDiagnostics, AgentReplayResult } from './replay.js';
