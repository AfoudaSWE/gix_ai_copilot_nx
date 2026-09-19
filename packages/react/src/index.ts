'use client';

export {
  CopilotProvider,
  useCopilot,
  useCopilotChat,
  useCopilotStatus,
  useMessages,
  useThread,
  useToolCalls,
} from './provider.js';
export type {
  ChatActions,
  ChatSnapshot,
  ChatStatus,
  CopilotAccess,
  CopilotChatResult,
  CopilotContextOptions,
  CopilotMessage,
  CopilotProviderProps,
  ToolCallState,
} from './types.js';

export { useCopilotContext, useCopilotContextDebug } from './context-hooks.js';
export type { CopilotContextDebug, UseCopilotContextOptions } from './context-hooks.js';

export { useCopilotState } from './state-hooks.js';
export type { ExposeStateToModel, UseCopilotStateOptions } from './state-hooks.js';

export { useFrontendTool } from './frontend-tool-hooks.js';
export type { UseFrontendToolOptions } from './frontend-tool-hooks.js';

// Re-exported so a consumer of the React SDK never needs a direct `@gixcopilot/context`
// dependency just to type a `useCopilotContext`/`useCopilotState` call (Section 63).
export type {
  ContextExclusionReason,
  ContextInspection,
  ContextPriority,
  ContextScope,
  ContextSensitivity,
  ResolvedContext,
  StateScope,
  StateValidationResult,
  StateValidator,
} from '@gixcopilot/context';

// Re-exported (Phase 5) so a consumer never needs a direct `@gixcopilot/protocol`/
// `@gixcopilot/tools` dependency just to type a `useFrontendTool`/`useToolCalls` call.
export type { ToolExecutionContext, ToolMetadata } from '@gixcopilot/tools';
export type { ToolResult, ToolSource } from '@gixcopilot/protocol';
