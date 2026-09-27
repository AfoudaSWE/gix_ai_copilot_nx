export { COPILOT_KEY, createCopilot, createCopilotPlugin, provideCopilot, useCopilot } from './copilot.js';
export type { Copilot, CopilotConfig } from './copilot.js';
export { useCopilotContext, useFrontendTool } from './composables.js';
export type { CopilotContextItem, FrontendToolOptions } from './composables.js';
export { CopilotChat } from './chat.js';
export type {
  ApprovalState,
  ChatSnapshot,
  ChatStatus,
  CopilotMessage,
  GenerativeUIRequestState,
  ToolCallState,
} from '@gixcopilot/headless';
