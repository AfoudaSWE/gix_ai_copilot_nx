/**
 * A provider-neutral tool definition sent to a model (Section 35-37). `parameters` is a
 * JSON Schema object - never a Zod schema instance and never a provider-specific function-
 * calling shape. `@gixcopilot/tools`' `toToolManifestEntry` produces this same shape from a
 * canonical `ToolDefinition`; this type is declared independently here (not imported from
 * `@gixcopilot/tools`) so `@gixcopilot/provider` never depends on `@gixcopilot/tools` - see
 * project-architecture's dependency-direction rule (tools is a leaf consumed by server/react,
 * not by the provider runtime).
 */
export interface ModelToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly parameters: Readonly<Record<string, unknown>>;
}
