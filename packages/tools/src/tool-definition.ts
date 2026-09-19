import type { RunId, ThreadId, ToolActionPreview, ToolSecurityManifest } from '@gixcopilot/protocol';
import type { z } from 'zod';
import type { ToolMetadata } from './tool-metadata.js';

/**
 * Runtime metadata available to every tool executor (Section 23). Deliberately does not
 * carry an authenticated user/tenant/permission set yet - Phase 7 will add real identity
 * propagation; inventing an unenforced field here now would look like security without
 * being security (see the security skill). `metadata` is a free-form extension point (e.g.
 * for a future Phase 7 middleware to attach resolved identity before execution).
 */
export interface ToolExecutionContext {
  readonly runId: RunId;
  readonly threadId?: ThreadId;
  /** Aborts when the run is cancelled or the tool's timeout elapses. */
  readonly signal: AbortSignal;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export type ToolExecutor<TInput, TOutput> = (
  input: TInput,
  context: ToolExecutionContext,
) => Promise<TOutput>;

/**
 * The canonical tool abstraction (Section 8). One shape for every tool origin - native
 * backend, frontend, and (future, Phase 8) OpenAPI/MCP-derived tools all produce this same
 * type, so the registry/runtime never branches on origin except via `metadata.source`/
 * `metadata.executionLocation`. `outputSchema` is optional (Section 25) - a tool without one
 * skips output validation entirely, at the cost of losing that safety net.
 */
export interface ToolDefinition<TInput = unknown, TOutput = unknown> {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: z.ZodType<TInput>;
  readonly outputSchema?: z.ZodType<TOutput>;
  /**
   * Declared with method shorthand (not `execute: ToolExecutor<TInput, TOutput>`)
   * deliberately: TypeScript checks method parameters bivariantly, which is what lets a
   * `ToolDefinition<SpecificInput, SpecificOutput>` be stored/passed around as an
   * `AnyToolDefinition` (a heterogeneous collection of differently-typed tools, exactly what
   * a registry holds) without an `any`/unsafe-cast escape hatch. `defineTool`'s public
   * authoring API still gets full, strict input/output inference - this only affects how the
   * already-built `ToolDefinition` is stored.
   */
  execute(input: TInput, context: ToolExecutionContext): Promise<TOutput>;
  readonly metadata?: ToolMetadata;
  /**
   * Phase 7 security metadata (Section 19, 131) - declared here, not inside `metadata`, so it
   * reads as its own concern at the call site (`defineTool({ name, security: {...}, ... })`).
   * Classification only - it is never itself enforcement; the AI Action Firewall
   * (`@gixcopilot/security`) is what actually enforces it (see the action-firewall skill).
   * Wire-safe (`ToolSecurityManifest` lives in `@gixcopilot/protocol`) so it crosses the same
   * `ToolManifestEntry` boundary frontend tools already use.
   */
  readonly security?: ToolSecurityManifest;
  /**
   * Optional dry-run capability (Phase 7, Section 48-51): produces a preview of what
   * `execute()` would do, without performing the real mutation - never implemented by
   * calling `execute()` and then undoing it (Section 49's explicit prohibition). Also serves
   * as the "explain before execute" surface (Section 46-47) when combined with the tool's own
   * declared `security.risk`/`reversibility` - not every tool needs to implement this; one is
   * not required for every tool (Section 50).
   */
  dryRun?(input: TInput, context: ToolExecutionContext): Promise<ToolActionPreview>;
  /**
   * Conditional availability (Section 21). A plain `false` disables the tool unconditionally;
   * a function is re-evaluated by the resolver on every discovery call, so it can react to a
   * feature flag or the current page/route. Defaults to enabled (`true`) when omitted.
   */
  readonly enabled?: boolean | (() => boolean);
}

/** Any tool definition, ignoring its specific input/output types - the registry's storage type. */
export type AnyToolDefinition = ToolDefinition<unknown, unknown>;

export function isToolEnabled(tool: AnyToolDefinition): boolean {
  if (tool.enabled === undefined) return true;
  return typeof tool.enabled === 'function' ? tool.enabled() : tool.enabled;
}
