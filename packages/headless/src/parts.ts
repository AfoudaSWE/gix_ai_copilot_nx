import { createContextEngine, createContextRegistry, createCopilotStateStore } from '@gixcopilot/context';
import type { ContextEngine, ContextRegistry, CopilotStateStore } from '@gixcopilot/context';
import { createDefaultToolResolver, createToolRegistry, createToolRuntime, isToolEnabled, toToolManifest } from '@gixcopilot/tools';
import type { ToolRegistry, ToolRuntime } from '@gixcopilot/tools';
import { createGenerativeComponentRegistry } from '@gixcopilot/generative-ui';
import type { GenerativeComponentRegistry } from '@gixcopilot/generative-ui';
import type { ResolveContextMessage, ResolveToolManifest } from './chat-store.js';
import type { CopilotContextOptions } from './types.js';

/**
 * The framework-independent pieces one copilot instance owns: its application-context
 * registry and engine (Phase 4), shared state store (Phase 4/6), frontend tool registry and
 * the canonical tool runtime (Phase 5), and the trusted generative-UI component registry
 * (Phase 6). Every framework adapter creates exactly one set per provider instance - never a
 * module-level singleton - so sibling copilots never see each other's context, tools or state.
 */
export interface CopilotParts {
  readonly registry: ContextRegistry;
  readonly engine: ContextEngine;
  readonly stateStore: CopilotStateStore;
  readonly toolRegistry: ToolRegistry;
  readonly toolRuntime: ToolRuntime;
  readonly generativeComponentRegistry: GenerativeComponentRegistry;
}

export function createCopilotParts(options: CopilotContextOptions = {}): CopilotParts {
  const toolRegistry = createToolRegistry();
  return {
    registry: createContextRegistry(),
    engine: createContextEngine({ maxContextTokens: options.maxContextTokens, dataPolicy: options.dataPolicy }),
    stateStore: createCopilotStateStore(),
    toolRegistry,
    toolRuntime: createToolRuntime({ resolver: createDefaultToolResolver(toolRegistry) }),
    generativeComponentRegistry: createGenerativeComponentRegistry(),
  };
}

/** Releases everything registered into `parts` (context items, frontend tools, components). */
export function clearCopilotParts(parts: CopilotParts): void {
  parts.registry.clear();
  parts.toolRegistry.clear();
  parts.generativeComponentRegistry.clear();
}

/**
 * Resolves registered application context for the next run, or `undefined` when nothing is
 * registered - the fully synchronous fast path, so a copilot with no context dispatches on the
 * same tick and sends exactly what Phase 3 always sent.
 */
export function createContextMessageResolver(parts: Pick<CopilotParts, 'registry' | 'engine'>): ResolveContextMessage {
  return () => {
    if (parts.registry.list({ enabledOnly: true }).length === 0) return undefined;
    return parts.engine.resolve(parts.registry);
  };
}

/** Builds the frontend tool manifest to advertise, or `undefined` when nothing is enabled. */
export function createToolManifestResolver(parts: Pick<CopilotParts, 'toolRegistry'>): ResolveToolManifest {
  return () => {
    const enabled = parts.toolRegistry.list().filter(isToolEnabled);
    return enabled.length === 0 ? undefined : toToolManifest(enabled);
  };
}
