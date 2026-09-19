import type { RunId, ThreadId } from '@gixcopilot/protocol';
import { isToolEnabled } from './tool-definition.js';
import type { AnyToolDefinition } from './tool-definition.js';
import type { ToolRegistry } from './tool-registry.js';

/**
 * Context available when resolving which tools are available for a given call (Section 65-
 * 66). Phase 5 only uses `runId`/`threadId`; a Phase 7 permission-aware resolver would
 * extend this with the caller's authenticated identity and filter accordingly, without the
 * `ToolResolver` interface itself needing to change - this is the discovery-security
 * boundary the tool-system skill and Section 65 require.
 */
export interface ToolResolutionContext {
  readonly runId: RunId;
  readonly threadId?: ThreadId;
}

/**
 * The discovery boundary between "everything registered" and "what the model is actually
 * offered this call" (Section 20, 65-66). `registry.list()` is deliberately never wired
 * straight into a model request anywhere in this codebase - every call site goes through a
 * resolver, so Phase 7 can later swap in a permission-aware resolver (or wrap this default
 * one) without touching the registry or the runtime.
 */
export interface ToolResolver {
  resolve(context: ToolResolutionContext): Promise<readonly AnyToolDefinition[]>;
}

/** The Phase 5 default: every currently-enabled tool in the registry, unfiltered by identity. */
export function createDefaultToolResolver(registry: ToolRegistry): ToolResolver {
  return {
    resolve: () => Promise.resolve(registry.list().filter(isToolEnabled)),
  };
}

/** Resolves the union of several resolvers (e.g. a server's backend registry plus a
 * per-run set of client-declared frontend tool definitions), de-duplicating by name with
 * first-resolver-wins precedence. */
export function combineToolResolvers(...resolvers: readonly ToolResolver[]): ToolResolver {
  return {
    async resolve(context) {
      const seen = new Map<string, AnyToolDefinition>();
      for (const resolver of resolvers) {
        const tools = await resolver.resolve(context);
        for (const tool of tools) {
          if (!seen.has(tool.name)) seen.set(tool.name, tool);
        }
      }
      return Array.from(seen.values());
    },
  };
}

/** A resolver over a fixed, already-known list of tools (e.g. per-run frontend manifests). */
export function createStaticToolResolver(tools: readonly AnyToolDefinition[]): ToolResolver {
  return { resolve: () => Promise.resolve(tools) };
}
