import type { ToolExecutionLocation, ToolSource } from '@gixcopilot/protocol';

/**
 * How safe a tool is to run alongside other tool calls in the same batch (Section 52-53).
 * Deliberately small - this is local, in-process scheduling metadata, not a distributed
 * lock (see the tool-system skill's "don't overbuild" guidance). Defaults to `parallel-safe`
 * when omitted (Section 22's `readOnly` tools are the common case).
 */
export type ToolConcurrency = 'parallel-safe' | 'serial' | 'exclusive';

/**
 * A coarse side-effect classification a future Action Firewall (Phase 7) and approval
 * policy (Phase 7's HITL) can consume. This is classification metadata only in Phase 5 - it
 * is never itself an authorization or approval decision (Section 16, 63).
 */
export type ToolRiskClass = 'read-only' | 'reversible' | 'compensatable' | 'irreversible';

/**
 * Extensible tool metadata (Section 14). Every field is optional; `custom` is the escape
 * hatch for a source adapter (OpenAPI/MCP, Phase 8) to carry source-specific detail without
 * the core `ToolMetadata` shape growing per source.
 *
 * `requiredRole`/`requiredScopes` are intentionally NOT present here - Section 63 is explicit
 * that Phase 5 must not invent metadata that merely *looks like* authorization. Real
 * authorization (Phase 7) will consume `sensitivity`/`riskClass` plus its own policy data,
 * not a bolted-on role string with no enforcement behind it.
 */
export interface ToolMetadata {
  readonly category?: string;
  readonly tags?: readonly string[];
  readonly source?: ToolSource;
  readonly executionLocation?: ToolExecutionLocation;
  readonly readOnly?: boolean;
  readonly destructive?: boolean;
  readonly idempotent?: boolean;
  readonly riskClass?: ToolRiskClass;
  readonly timeoutMs?: number;
  readonly concurrency?: ToolConcurrency;
  /** Documentation-only sensitivity label (mirrors @gixcopilot/context's ContextSensitivity
   * convention) - not enforced as access control until Phase 7. */
  readonly sensitivity?: string;
  readonly custom?: Readonly<Record<string, unknown>>;
}
