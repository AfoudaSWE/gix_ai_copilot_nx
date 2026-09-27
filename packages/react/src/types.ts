import type { ClientModelReference, CopilotClient } from '@gixcopilot/client';
import type { ReactNode } from 'react';
import type { CopilotContextOptions } from '@gixcopilot/headless';

// Framework-neutral chat types live in @gixcopilot/headless since Phase 12 (shared with the
// Angular adapter); re-exported here unchanged so existing imports keep working.
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
  ResolvedContextSummary,
  ToolCallState,
  WorkflowRunState,
  WorkflowStepState,
} from '@gixcopilot/headless';

/** Connection configuration is exclusive: inject a client or supply an API base URL. */
export type CopilotProviderProps = {
  /** Offline UI tools only; never grants authority over server resources. Default false. */
  readonly localToolExecution?: boolean;
  readonly children: ReactNode;
  readonly model?: ClientModelReference;
  readonly threadId?: string;
  /** Optional - a provider with no registered context behaves exactly as in Phase 3. */
  readonly context?: CopilotContextOptions;
  /**
   * Phase 7 - extra headers merged into every request to the server (e.g. `Authorization`),
   * so the server's own `AuthenticationAdapter` has a credential to authenticate (Section
   * 13-14). Ignored when an already-constructed `client` is supplied - configure it there
   * instead. See `@gixcopilot/client`'s `CopilotClientOptions.getHeaders`.
   */
  readonly getHeaders?: () => Record<string, string> | Promise<Record<string, string>>;
} & (
  | { readonly runtimeUrl: string; readonly client?: never }
  | { readonly client: CopilotClient; readonly runtimeUrl?: never }
);
