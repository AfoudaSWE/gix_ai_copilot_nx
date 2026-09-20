import { toToolNameSegment } from '@gixcopilot/tools';
import type { RegistrationConflict } from './types.js';

/**
 * Namespaces an MCP tool under its server id (Section 74's `mcp.github.searchIssues`
 * convention) - always includes the fixed `mcp.` prefix, unlike `@gixcopilot/openapi`'s
 * optional namespace, since an MCP tool has no natural resource-path-derived namespace of its
 * own to fall back on; `mcp.<server>.<tool>` is the only deterministic scheme available here.
 * An explicit override name replaces the tool-name segment, not the whole namespaced name, so
 * two servers can never collide on override alone.
 */
export function deriveMcpToolName(serverId: string, toolName: string, overrideName?: string): string {
  const leaf = overrideName !== undefined ? toToolNameSegment(overrideName) : toToolNameSegment(toolName);
  return `mcp.${toToolNameSegment(serverId)}.${leaf}`;
}

/**
 * Detects tool-name collisions across a batch of generated names (mirrors
 * `@gixcopilot/openapi`'s `detectNamingConflicts`) - two tools resolving to the same name is
 * reported, never silently overwritten.
 */
export function detectNamingConflicts(
  entries: readonly { readonly name: string; readonly operation: string }[],
): readonly RegistrationConflict[] {
  const byName = new Map<string, string[]>();
  for (const entry of entries) {
    const operations = byName.get(entry.name) ?? [];
    operations.push(entry.operation);
    byName.set(entry.name, operations);
  }
  const conflicts: RegistrationConflict[] = [];
  for (const [name, operations] of byName) {
    if (operations.length > 1) conflicts.push({ name, operations });
  }
  return conflicts;
}
