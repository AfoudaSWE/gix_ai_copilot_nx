import type { ClientModelReference, CopilotClient } from '@gixcopilot/client';
import type {
  Message,
  PublicCopilotError,
  Thread,
  ToolActionPreview,
  ToolActionRisk,
  ToolActionReversibility,
  ToolApprovalLevel,
  ToolCallId,
  ToolResult,
  ToolSource,
  Usage,
  FinishReason,
} from '@gixcopilot/protocol';
import type { ReactNode } from 'react';

/** A protocol message with local presentation metadata; wire content is unchanged. */
export interface CopilotMessage extends Message {
  readonly status: 'complete' | 'streaming' | 'stopped' | 'error';
}

/** Exactly one generation state is observable at a time. */
export type ChatStatus = 'idle' | 'submitting' | 'streaming' | 'waiting_for_approval' | 'completed' | 'stopped' | 'error';

/**
 * Headless tool activity state (Section 59-61, added in Phase 5) - a generic timeline of
 * every tool call in the current run, regardless of origin, for a custom/headless UI (or the
 * default `CopilotChat` activity rendering) to display without parsing raw protocol events
 * itself. `arguments`/`result` are present for an advanced consumer that explicitly wants
 * them; the *default* UI intentionally does not render them (Section 60).
 */
export interface ToolCallState {
  readonly id: ToolCallId;
  readonly name: string;
  readonly source: ToolSource;
  readonly status: 'requested' | 'running' | 'succeeded' | 'failed';
  readonly arguments: Readonly<Record<string, unknown>>;
  readonly result?: unknown;
  readonly error?: PublicCopilotError;
}

/**
 * Headless approval state (Phase 7, Section 76, 81-82) - a per-run timeline of every action
 * that paused for human approval, mirroring `ToolCallState`'s own pattern so a custom/
 * headless approval UI never needs to parse raw `approval.*` protocol events itself.
 */
export interface ApprovalState {
  readonly approvalId: string;
  readonly toolCallId: ToolCallId;
  readonly action: string;
  readonly approvalLevel: ToolApprovalLevel;
  readonly summary: string;
  readonly status: 'pending' | 'approved' | 'rejected' | 'expired' | 'cancelled';
  readonly risk?: ToolActionRisk;
  readonly reversibility?: ToolActionReversibility;
  readonly expiresAt?: string;
  readonly preview?: ToolActionPreview;
  readonly decidedBy?: string;
}

interface ChatSnapshotBase {
  readonly messages: readonly CopilotMessage[];
  readonly thread: Thread | null;
  readonly runId: string | null;
  readonly usage: Usage | undefined;
  readonly finishReason: FinishReason | undefined;
  /** Cleared at the start of every new run (Section 59) - this is per-turn activity, not a
   * persistent tool-call history across the whole conversation. */
  readonly toolCalls: readonly ToolCallState[];
  /** Cleared at the start of every new run, same as `toolCalls` above. */
  readonly approvals: readonly ApprovalState[];
}

/** Immutable chat snapshot. Errors exist only in the error state. */
export type ChatSnapshot = ChatSnapshotBase &
  (
    | { readonly status: Exclude<ChatStatus, 'error'>; readonly error: null }
    | { readonly status: 'error'; readonly error: PublicCopilotError }
  );

/** Actions are stable for the lifetime of a provider configuration. */
export interface ChatActions {
  readonly invokeTool: (name: string, args: Readonly<Record<string, unknown>>) => Promise<ToolResult>;
  /** Accept a nonblank user turn unless busy/disposed. True means accepted, not completed. */
  readonly sendMessage: (text: string) => boolean;
  /** Cancel the actual client run, preserving partial text. */
  readonly stop: () => void;
  /** Replay the failed turn with the same user message and replace its partial answer. */
  readonly retry: () => boolean;
  /** Replace the latest completed/stopped answer by replaying its user turn. */
  readonly regenerate: () => boolean;
  /** Cancel and reset local history/thread; does not delete server data. */
  readonly clear: () => void;
  /** Phase 7, Section 83 - approves a pending action. Resolves once the server accepts the
   * decision; the resulting state update itself still arrives as an `approval.approved`
   * event on the run, same as any other server-driven state change. */
  readonly approveAction: (approvalId: string, comment?: string) => Promise<void>;
  readonly rejectAction: (approvalId: string, comment?: string) => Promise<void>;
}

/** Full headless chat subscription plus stable actions. */
export type CopilotChatResult = ChatSnapshot & ChatActions;

/** Stable SDK access without subscribing to token updates. */
export interface CopilotAccess extends ChatActions {
  readonly client: CopilotClient;
}

/** Phase 4 application-context tuning (Section 25). Omit for the engine's own default. */
export interface CopilotContextOptions {
  readonly dataPolicy?: { redact(data: unknown): unknown };
  /** Total token budget resolved application context may consume. Default 8000. */
  readonly maxContextTokens?: number;
}

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
