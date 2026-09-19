/** All built-in UI copy can be overridden per chat for localization. */
export interface CopilotLabels {
  readonly send: string;
  readonly stop: string;
  readonly retry: string;
  readonly regenerate: string;
  readonly clear: string;
  readonly copy: string;
  readonly copied: string;
  readonly copyFailed: string;
  readonly code: string;
  readonly input: string;
  readonly placeholder: string;
  readonly inputHint: string;
  readonly open: string;
  readonly close: string;
  readonly conversation: string;
  readonly user: string;
  readonly assistant: string;
  readonly system: string;
  readonly emptyTitle: string;
  readonly emptyDescription: string;
  readonly suggestions: string;
  readonly submitting: string;
  readonly streaming: string;
  readonly completed: string;
  readonly stopped: string;
  readonly failed: string;
  readonly connectionError: string;
  readonly timeoutError: string;
  readonly rateLimitError: string;
  readonly jumpToLatest: string;
  readonly renderError: string;
  /** Tool activity (Section 59-61, added in Phase 5) - generic, name-agnostic phrasing since
   * a tool's own `description` (not surfaced here by default - Section 60) is the only
   * source of anything tool-specific. */
  readonly toolRunning: string;
  readonly toolCompleted: string;
  readonly toolFailed: string;
  /** Approval UI (Phase 7, Section 76-79). */
  readonly approvalTitle: string;
  readonly approvalPending: string;
  readonly approvalApproved: string;
  readonly approvalRejected: string;
  readonly approvalExpired: string;
  readonly approvalApprove: string;
  readonly approvalReject: string;
  readonly approvalCommentPlaceholder: string;
  readonly approvalRequires: string;
  readonly approvalPreviewTitle: string;
  readonly denialTitle: string;
}

/** English defaults, centralized rather than embedded throughout the components. */
export const DEFAULT_LABELS: CopilotLabels = {
  send: 'Send',
  stop: 'Stop',
  retry: 'Retry',
  regenerate: 'Regenerate',
  clear: 'Clear chat',
  copy: 'Copy code',
  copied: 'Copied',
  copyFailed: 'Copy unavailable',
  code: 'Code',
  input: 'Message',
  placeholder: 'Ask anything…',
  inputHint: 'Enter to send · Shift + Enter for a new line',
  open: 'Open copilot',
  close: 'Close copilot',
  conversation: 'Conversation',
  user: 'You',
  assistant: 'Copilot',
  system: 'System',
  emptyTitle: 'A little help, right here.',
  emptyDescription: 'Ask a question, explore an idea, or start with a suggestion.',
  suggestions: 'Suggested questions',
  submitting: 'Preparing a response…',
  streaming: 'Responding…',
  completed: 'Response complete',
  stopped: 'Generation stopped',
  failed: 'The request could not be completed.',
  connectionError: 'Connection lost. Try again.',
  timeoutError: 'The request timed out. Try again.',
  rateLimitError: 'Too many requests. Wait a moment, then try again.',
  jumpToLatest: 'Jump to latest',
  renderError: 'This message could not be displayed.',
  toolRunning: 'Running',
  toolCompleted: 'completed',
  toolFailed: 'failed',
  approvalTitle: 'Approval required',
  approvalPending: 'Waiting for approval',
  approvalApproved: 'Approved',
  approvalRejected: 'Not approved',
  approvalExpired: 'Approval expired',
  approvalApprove: 'Approve',
  approvalReject: 'Reject',
  approvalCommentPlaceholder: 'Add a comment (optional)',
  approvalRequires: 'Requires',
  approvalPreviewTitle: 'This would change',
  denialTitle: 'Action not permitted',
};
