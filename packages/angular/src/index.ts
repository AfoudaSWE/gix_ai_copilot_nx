/*
 * Public API of @gixcopilot/angular. Everything here adapts the framework-independent
 * client/headless/context/tools/generative-ui packages to Angular; no runtime, protocol or
 * state logic is reimplemented.
 */
export { COPILOT_CONFIG } from './config.js';
export type { CopilotConfig } from './config.js';
export { provideCopilot } from './provide.js';
export { CopilotService } from './copilot.service.js';
export { injectCopilot, injectCopilotContext, injectCopilotState, injectFrontendTool } from './inject.js';
export type {
  CopilotContextItem,
  CopilotStateHandle,
  CopilotStateOptions,
  ExposeStateToModel,
  FrontendToolOptions,
} from './inject.js';
export { CopilotComponentRegistry, GenerativeUiOutletComponent, injectGenerativeComponent } from './generative-ui.js';
export type { GenerativeComponentOptions } from './generative-ui.js';
export { CopilotChatComponent } from './chat.component.js';

export type {
  AgentRunState,
  ApprovalState,
  ChatSnapshot,
  ChatStatus,
  CopilotContextOptions,
  CopilotMessage,
  GenerativeUIRequestState,
  ToolCallState,
  WorkflowRunState,
} from '@gixcopilot/headless';
