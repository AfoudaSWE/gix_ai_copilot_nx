'use client';

export {
  CopilotProvider,
  useCopilot,
  useCopilotChat,
  useCopilotStatus,
  useMessages,
  useThread,
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
} from './types.js';

export { useCopilotContext, useCopilotContextDebug } from './context-hooks.js';
export type { CopilotContextDebug, UseCopilotContextOptions } from './context-hooks.js';

export { useCopilotState } from './state-hooks.js';
export type { ExposeStateToModel, UseCopilotStateOptions } from './state-hooks.js';

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
