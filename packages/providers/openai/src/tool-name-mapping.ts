/**
 * OpenAI's function-calling API restricts tool/function names to `^[a-zA-Z0-9_-]+$` - it
 * rejects the SDK's canonical dot-separated tool names (e.g. `applications.getStatus`)
 * outright with a 400. `@gixcopilot/tools`' `tool-name.ts` already documents this exact
 * seam ("a provider adapter maps this name onto whatever naming restriction it imposes...
 * and maps the result back reversibly"); this is that mapping for OpenAI specifically.
 *
 * Canonical names are one or more dot-separated camelCase segments matching
 * `[a-z][a-zA-Z0-9]*` - no segment can ever contain `_`, so replacing every `.` with `_` is
 * an unambiguous, reversible encoding: any `_` seen in an OpenAI-facing name is known to
 * have come from a `.`.
 */
export function toOpenAIToolName(name: string): string {
  return name.replace(/\./g, '_');
}

export function fromOpenAIToolName(name: string): string {
  return name.replace(/_/g, '.');
}
