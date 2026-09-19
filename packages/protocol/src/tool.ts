import type { ToolCallId } from './ids.js';
import type { PublicCopilotError } from './errors.js';

/**
 * Where a tool definition originated (Section 15). Only `native` (backend) and `frontend`
 * are implemented in Phase 5 - `openapi`, `mcp`, and `agent` are reserved identifiers so
 * later phases can add those sources without a protocol-breaking rename (see
 * docs/adr/0010-canonical-tool-architecture.md).
 */
export type ToolSource = 'native' | 'frontend' | 'openapi' | 'mcp' | 'agent';

/** Where a tool call actually executes. Determines the routing a runtime must perform. */
export type ToolExecutionLocation = 'server' | 'client';

/**
 * A single, provider-neutral tool invocation requested by the model. `arguments` is the
 * already-parsed-from-JSON payload (an object), not a raw string - assembling fragmented
 * provider deltas into this shape is a provider-adapter concern (see the ai-runtime skill).
 */
export interface ToolCall {
  readonly id: ToolCallId;
  readonly name: string;
  readonly arguments: Readonly<Record<string, unknown>>;
}

/**
 * The outcome of executing one ToolCall, normalized regardless of tool origin (Section 26).
 * A discriminated union so a consumer can switch exhaustively instead of checking an
 * `error`-is-undefined convention.
 */
export type ToolResult =
  | { readonly status: 'success'; readonly toolCallId: ToolCallId; readonly data: unknown }
  | {
      readonly status: 'error';
      readonly toolCallId: ToolCallId;
      readonly error: PublicCopilotError;
    };

/**
 * The internal lifecycle notification shape a tool-calling Executor yields mid-stream
 * (Section 32-33), before `@gixcopilot/core`'s runtime wraps each phase into the
 * corresponding wire-level `tool.*` CopilotEvent (see events.ts). Kept here (not in
 * `@gixcopilot/core`) so both core's Executor and a server's tool runtime can share one
 * shape without either package depending on the other.
 */
export type ToolLifecycleEvent =
  | {
      readonly phase: 'requested';
      readonly toolCallId: ToolCallId;
      readonly name: string;
      readonly arguments: Readonly<Record<string, unknown>>;
      readonly source: ToolSource;
    }
  | { readonly phase: 'started'; readonly toolCallId: ToolCallId; readonly name: string }
  | {
      readonly phase: 'completed';
      readonly toolCallId: ToolCallId;
      readonly name: string;
      readonly result: unknown;
    }
  | {
      readonly phase: 'failed';
      readonly toolCallId: ToolCallId;
      readonly name: string;
      readonly error: PublicCopilotError;
    };

/**
 * A provider-neutral, wire-safe manifest entry describing one tool the model may call -
 * sent to the model (via a provider adapter) and, for a client-declared frontend tool, sent
 * from client to server as part of a run request (Section 45-46). `parameters` is a JSON
 * Schema object (produced by `@gixcopilot/tools`' `defineTool`/zod, e.g. via `z.toJSONSchema`),
 * never a Zod schema instance - Zod schemas cannot cross the wire or a provider-neutral
 * boundary.
 */
export interface ToolManifestEntry {
  readonly name: string;
  readonly description: string;
  readonly parameters: Readonly<Record<string, unknown>>;
  readonly executionLocation: ToolExecutionLocation;
}
