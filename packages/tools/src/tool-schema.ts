import { z } from 'zod';
import type { ToolManifestEntry } from '@gixcopilot/protocol';
import type { AnyToolDefinition } from './tool-definition.js';

/**
 * Converts one tool's Zod input schema into the provider-neutral JSON Schema manifest entry
 * that crosses process/wire boundaries (Section 36-37, 45-46) - a `z.ZodType` instance
 * itself is never sent to a model or over HTTP. Uses Zod's own native JSON Schema
 * conversion (no extra dependency - see the dependency-policy skill).
 */
export function toToolManifestEntry(tool: AnyToolDefinition): ToolManifestEntry {
  const parameters = z.toJSONSchema(tool.inputSchema, { target: 'draft-7' }) as Readonly<
    Record<string, unknown>
  >;
  return {
    name: tool.name,
    description: tool.description,
    parameters,
    executionLocation: tool.metadata?.executionLocation ?? 'server',
    ...(tool.security !== undefined ? { security: tool.security } : {}),
  };
}

export function toToolManifest(
  tools: readonly AnyToolDefinition[],
): readonly ToolManifestEntry[] {
  return tools.map(toToolManifestEntry);
}
