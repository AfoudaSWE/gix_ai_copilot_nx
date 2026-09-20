/** Distinguishes what kind of external capability source an integration wraps (Section 93) -
 * deliberately just a label here; it changes nothing about how a generated tool executes or is
 * enforced (Section 93's "do not change canonical tool semantics based solely on source type"). */
export type IntegrationType = 'openapi' | 'mcp';

/** Basic health/state information (Section 92) - useful for runtime diagnostics, not itself an
 * authorization signal (a `ready` integration still has every tool gated by the Action
 * Firewall exactly like any other). */
export type IntegrationHealth = 'ready' | 'degraded' | 'error' | 'disconnected';

/**
 * The uniform shape this package tracks for one integration (Section 91), regardless of
 * whether it wraps an `@gixcopilot/openapi` or `@gixcopilot/mcp` integration - this package
 * depends on neither (see `eslint.config.js`'s `scope:integrations` dependency constraint), so
 * a caller that owns both adapts each concrete integration object into this plain record
 * itself (see this package's README/docs for the adapter pattern) rather than this package
 * importing their types directly.
 */
export interface IntegrationRecord {
  readonly id: string;
  readonly type: IntegrationType;
  readonly name: string;
  readonly status: IntegrationHealth;
  /** A short, human-readable description of where this integration's capabilities come from,
   * e.g. an OpenAPI document's title or an MCP server's id - never a credential or full spec. */
  readonly source: string;
  /** Tool names (or a summary count) this integration currently contributes - kept as an
   * opaque list of strings rather than a `ToolDefinition[]` so this package never needs to
   * import `@gixcopilot/tools` either. */
  readonly capabilities: readonly string[];
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface IntegrationSummary {
  readonly id: string;
  readonly type: IntegrationType;
  readonly name: string;
  readonly status: IntegrationHealth;
  readonly capabilityCount: number;
}
