'use client';

export {
  CopilotProvider,
  useAgentDelegations,
  useAgentHandoffs,
  useAgentRun,
  useAgentRuns,
  useApproval,
  useApprovals,
  useCopilot,
  useCopilotChat,
  useCopilotContextDiagnostics,
  useCopilotStatus,
  useMessages,
  usePendingApprovals,
  useThread,
  useToolCalls,
  useWorkflowRun,
  useWorkflowRuns,
} from './provider.js';
export type {
  AgentDelegationState,
  AgentHandoffState,
  AgentRunState,
  ApprovalState,
  ChatActions,
  ChatSnapshot,
  ChatStatus,
  CopilotAccess,
  CopilotChatResult,
  CopilotContextOptions,
  CopilotMessage,
  CopilotProviderProps,
  ResolvedContextSummary,
  ToolCallState,
  WorkflowRunState,
  WorkflowStepState,
} from './types.js';

export { useCopilotContext, useCopilotContextDebug } from './context-hooks.js';
export type { CopilotContextDebug, UseCopilotContextOptions } from './context-hooks.js';

export { useCopilotState } from './state-hooks.js';
export type { ExposeStateToModel, UseCopilotStateOptions } from './state-hooks.js';

export { useFrontendTool } from './frontend-tool-hooks.js';
export type { UseFrontendToolOptions } from './frontend-tool-hooks.js';

export {
  useGenerativeComponent,
  useGenerativeUIRequests,
  useInvokeTool,
  useResolveToolRenderer,
  useToolRenderer,
} from './generative-ui-hooks.js';
export type {
  GenerativeUIRequestState,
  UseGenerativeComponentOptions,
  UseToolRendererOptions,
} from './generative-ui-hooks.js';
export { useCopilotInternals } from './internals.js';
export type { CopilotInternals, ToolRenderFn, ToolRenderState } from './internals.js';

// Re-exported so a consumer of the React SDK never needs a direct `@gixcopilot/context`
// dependency just to type a `useCopilotContext`/`useCopilotState` call (Section 63).
export type {
  ContextExclusionReason,
  ContextInspection,
  ContextPriority,
  ContextScope,
  ContextSensitivity,
  ResolvedContext,
  StatePatchResult,
  StateScope,
  StateValidationResult,
  StateValidator,
} from '@gixcopilot/context';

// Re-exported (Phase 5) so a consumer never needs a direct `@gixcopilot/protocol`/
// `@gixcopilot/tools` dependency just to type a `useFrontendTool`/`useToolCalls` call.
export type { ToolExecutionContext, ToolMetadata } from '@gixcopilot/tools';
export type { ToolResult, ToolSource } from '@gixcopilot/protocol';

// Re-exported (Phase 7) so a consumer never needs a direct `@gixcopilot/protocol` dependency
// just to type a `useApprovals`/`ApprovalState` field.
export type {
  ToolActionPreview,
  ToolActionRisk,
  ToolActionReversibility,
  ToolApprovalLevel,
} from '@gixcopilot/protocol';

// Re-exported (Phase 6) so a consumer never needs a direct `@gixcopilot/generative-ui`
// dependency just to type a `useGenerativeComponent` call.
export type { GenerativeComponentMetadata } from '@gixcopilot/generative-ui';
export { useCitations } from './citation-hooks.js';
export type { CitationData, UseCitationsResult } from './citation-hooks.js';
