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
    }
  /**
   * Phase 7 HITL phases - reuse this exact "internal phase -> wire event" pipeline (Section
   * 89) rather than inventing a parallel notification path. A run pauses (Section 38) by the
   * tool-calling executor blocking on `ApprovalStore.awaitDecision()` after reporting
   * `approval_requested`, exactly the way a pending frontend tool call already blocks on
   * `frontendToolBridge.awaitResult()` after reporting `requested`.
   */
  | {
      readonly phase: 'approval_requested';
      readonly toolCallId: ToolCallId;
      readonly approvalId: string;
      readonly action: string;
      readonly approvalLevel: ToolApprovalLevel;
      readonly summary: string;
      readonly risk?: ToolActionRisk;
      readonly reversibility?: ToolActionReversibility;
      readonly expiresAt?: string;
      readonly preview?: ToolActionPreview;
    }
  | {
      readonly phase: 'approval_approved';
      readonly toolCallId: ToolCallId;
      readonly approvalId: string;
      readonly decidedBy?: string;
    }
  | {
      readonly phase: 'approval_rejected';
      readonly toolCallId: ToolCallId;
      readonly approvalId: string;
      readonly decidedBy?: string;
      readonly reason?: string;
    }
  | { readonly phase: 'approval_expired'; readonly toolCallId: ToolCallId; readonly approvalId: string };

/**
 * A provider-neutral, wire-safe manifest entry describing one tool the model may call -
 * sent to the model (via a provider adapter) and, for a client-declared frontend tool, sent
 * from client to server as part of a run request (Section 45-46). `parameters` is a JSON
 * Schema object (produced by `@gixcopilot/tools`' `defineTool`/zod, e.g. via `z.toJSONSchema`),
 * never a Zod schema instance - Zod schemas cannot cross the wire or a provider-neutral
 * boundary.
 */
/**
 * Action classification dimensions (Phase 7, Section 28-29) - two independent axes, never
 * conflated into one enum. `risk` is "what kind of effect can this have"; `reversibility` is
 * "how hard is it to undo" - a `write` action can be `reversible` (reassign) or
 * `irreversible` (send an email); a tool declares both only when the dimension applies
 * (`reversibility` has no meaning for `read-only`).
 */
export type ToolActionRisk = 'read-only' | 'write' | 'destructive';
export type ToolActionReversibility = 'reversible' | 'compensatable' | 'irreversible';

/**
 * Fixed approval-level vocabulary (Phase 7, Section 31) - defined here (protocol), not in
 * `@gixcopilot/security`, so the wire-safe `ToolManifestEntry` and the security package's
 * richer runtime types share one source of truth instead of two enums that could drift.
 */
export type ToolApprovalLevel =
  | 'none'
  | 'user-confirmation'
  | 'supervisor'
  | 'admin'
  | 'two-person';

/** Data sensitivity classification (Phase 7, Section 52). */
export type DataClassification = 'public' | 'internal' | 'confidential' | 'pii' | 'secret';

/**
 * A tool's declared security metadata (Phase 7, Section 19), wire-safe so it travels the same
 * path as the rest of `ToolManifestEntry` for both backend (`defineTool`'s `security` option)
 * and frontend (`useFrontendTool`'s `security` option) tools. This is classification/policy-
 * input metadata only - it is never itself an authorization decision; the AI Action Firewall
 * (`@gixcopilot/security`) is what actually enforces it (see the action-firewall skill).
 */
export interface ToolSecurityManifest {
  readonly requiredPermissions?: readonly string[];
  readonly risk?: ToolActionRisk;
  readonly reversibility?: ToolActionReversibility;
  /** Explicit override of the default risk-based approval policy for this specific tool. */
  readonly approval?: ToolApprovalLevel;
  readonly dataClassification?: DataClassification;
}

export interface ToolManifestEntry {
  readonly name: string;
  readonly description: string;
  readonly parameters: Readonly<Record<string, unknown>>;
  readonly executionLocation: ToolExecutionLocation;
  readonly security?: ToolSecurityManifest;
}

/**
 * A wire-safe dry-run preview (Phase 7, Section 48-51, 136) - "what this action would do,"
 * produced without performing the real mutation. Sensitive fields must already be filtered
 * before this is ever sent (Section 51) - this type carries no classification of its own.
 */
export interface ToolChangePreview {
  readonly field: string;
  readonly before?: unknown;
  readonly after?: unknown;
}

export interface ToolActionPreview {
  readonly summary: string;
  readonly changes?: readonly ToolChangePreview[];
  readonly warnings?: readonly string[];
}
