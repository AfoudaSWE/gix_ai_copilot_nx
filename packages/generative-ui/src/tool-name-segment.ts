/**
 * Converts an arbitrary developer-chosen identifier (a component name, a state id - kebab-
 * case and snake_case are both extremely common conventions for either) into a valid
 * `@gixcopilot/tools` name segment: camelCase, starting with a lowercase letter. Used by
 * both `generative-ui-tool.ts` and `state-patch-tool.ts` so `useGenerativeComponent({ name:
 * 'ApplicationCard' })` and `useCopilotState({ id: 'application-filters', modelWritable:
 * true })` both derive a valid reserved tool name instead of throwing at registration time
 * for the (very common) non-camelCase case.
 */
export function toToolNameSegment(value: string): string {
  const camel = value
    .replace(/[^a-zA-Z0-9]+(.)/g, (_match, char: string) => char.toUpperCase())
    .replace(/[^a-zA-Z0-9]/g, '');
  return camel.slice(0, 1).toLowerCase() + camel.slice(1);
}
