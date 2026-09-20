/**
 * Converts an arbitrary developer-chosen identifier (a component name, a state id, an
 * OpenAPI `operationId`, an MCP tool name - kebab-case and snake_case are all extremely
 * common conventions across these sources) into a valid `@gixcopilot/tools` name segment:
 * camelCase, starting with a lowercase letter. Shared by `@gixcopilot/generative-ui`
 * (reserved `ui.render.*`/`state.patch.*` tool names), `@gixcopilot/openapi`, and
 * `@gixcopilot/mcp` (Section 16-19's deterministic naming requirement) so this conversion
 * exists exactly once.
 */
export function toToolNameSegment(value: string): string {
  const camel = value
    .replace(/[^a-zA-Z0-9]+(.)/g, (_match, char: string) => char.toUpperCase())
    .replace(/[^a-zA-Z0-9]/g, '');
  return camel.slice(0, 1).toLowerCase() + camel.slice(1);
}
