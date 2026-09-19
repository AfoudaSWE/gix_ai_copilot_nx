import type { ClientModelReference, CopilotClient } from '@gixcopilot/client';
import type {
  Message,
  PublicCopilotError,
  Thread,
  ToolCallId,
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
export type ChatStatus = 'idle' | 'submitting' | 'streaming' | 'completed' | 'stopped' | 'error';

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

interface ChatSnapshotBase {
  readonly messages: readonly CopilotMessage[];
  readonly thread: Thread | null;
  readonly runId: string | null;
  readonly usage: Usage | undefined;
  readonly finishReason: FinishReason | undefined;
  /** Cleared at the start of every new run (Section 59) - this is per-turn activity, not a
   * persistent tool-call history across the whole conversation. */
  readonly toolCalls: readonly ToolCallState[];
}

/** Immutable chat snapshot. Errors exist only in the error state. */
export type ChatSnapshot = ChatSnapshotBase &
  (
    | { readonly status: Exclude<ChatStatus, 'error'>; readonly error: null }
    | { readonly status: 'error'; readonly error: PublicCopilotError }
  );

/** Actions are stable for the lifetime of a provider configuration. */
export interface ChatActions {
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
}

/** Full headless chat subscription plus stable actions. */
export type CopilotChatResult = ChatSnapshot & ChatActions;

/** Stable SDK access without subscribing to token updates. */
export interface CopilotAccess extends ChatActions {
  readonly client: CopilotClient;
}

/** Phase 4 application-context tuning (Section 25). Omit for the engine's own default. */
export interface CopilotContextOptions {
  /** Total token budget resolved application context may consume. Default 8000. */
  readonly maxContextTokens?: number;
}

/** Connection configuration is exclusive: inject a client or supply an API base URL. */
export type CopilotProviderProps = {
  readonly children: ReactNode;
  readonly model?: ClientModelReference;
  readonly threadId?: string;
  /** Optional - a provider with no registered context behaves exactly as in Phase 3. */
  readonly context?: CopilotContextOptions;
} & (
  | { readonly runtimeUrl: string; readonly client?: never }
  | { readonly client: CopilotClient; readonly runtimeUrl?: never }
);
