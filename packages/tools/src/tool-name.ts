import { CopilotError } from '@gixcopilot/protocol';

/**
 * Tool identity convention (Section 11-12): a stable, deterministic, namespaced dot name,
 * e.g. `applications.getStatus`. Each segment is a camelCase identifier; the namespace is
 * just the leading segment(s) - there is no separate `namespace` field to keep in sync with
 * `name`, avoiding two sources of truth for one identity. This becomes the tool's identity
 * for the registry, permission checks (Phase 7), audit, and evals (Phase 11) - never
 * provider-specific (a provider adapter maps this name onto whatever naming restriction it
 * imposes, e.g. replacing `.` with `_`, and maps the result back reversibly).
 */
const TOOL_NAME_PATTERN = /^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)+$|^[a-z][a-zA-Z0-9]*$/;

export function isValidToolName(name: string): boolean {
  return TOOL_NAME_PATTERN.test(name);
}

export function assertValidToolName(name: string): void {
  if (!isValidToolName(name)) {
    throw CopilotError.validation(
      `Invalid tool name "${name}". Tool names must be one or more dot-separated camelCase ` +
        'segments, e.g. "applications.getStatus" or "math.add".',
      { name },
    );
  }
}

/** The leading segment(s) of a tool name, e.g. "applications" for "applications.getStatus". */
export function toolNamespaceOf(name: string): string | undefined {
  const lastDot = name.lastIndexOf('.');
  return lastDot === -1 ? undefined : name.slice(0, lastDot);
}
