'use client';

export {
  CopilotChat,
  ChatHeader,
  MessageList,
  UserMessage,
  AssistantMessage,
  ChatInput,
  SendButton,
  StopButton,
  RetryButton,
  RegenerateButton,
  Suggestions,
  EmptyState,
  TypingIndicator,
  ErrorMessage,
  ToolActivity,
} from './components.js';
export type {
  CopilotChatProps,
  CopilotComponents,
  ChatHeaderProps,
  MessageProps,
  MessageListProps,
  ChatInputProps,
  SuggestionsProps,
  EmptyStateProps,
  ToolActivityProps,
} from './components.js';
export { CopilotPopup, CopilotSidebar } from './panels.js';
export type { CopilotPanelProps } from './panels.js';
export { Markdown, CodeBlock } from './markdown.js';
export type { MarkdownProps, CodeBlockProps } from './markdown.js';
export { DEFAULT_LABELS } from './labels.js';
export type { CopilotLabels } from './labels.js';

export { ApprovalCard, ApprovalList, SecurityDenial } from './approval.js';
export type { ApprovalCardProps, ApprovalListProps } from './approval.js';
