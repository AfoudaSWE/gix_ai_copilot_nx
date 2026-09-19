'use client';

import { createContext, useContext } from 'react';
import type { ComponentType, ReactNode } from 'react';
import { CopilotError } from '@gixcopilot/protocol';
import type { PublicCopilotError } from '@gixcopilot/protocol';
import type { ContextEngine, ContextRegistry, CopilotStateStore } from '@gixcopilot/context';
import type { ToolRegistry, ToolRuntime } from '@gixcopilot/tools';
import type { GenerativeComponentRegistry } from '@gixcopilot/generative-ui';

/** What `useToolRenderer`'s `render` callback receives (Section 27-31). */
export interface ToolRenderState {
  readonly status: 'requested' | 'running' | 'succeeded' | 'failed';
  readonly arguments: Readonly<Record<string, unknown>>;
  readonly result?: unknown;
  readonly error?: PublicCopilotError;
}
export type ToolRenderFn = (state: ToolRenderState) => ReactNode;

/**
 * Per-`CopilotProvider` instance context/state universe (Section 65 - isolated, not a
 * global singleton). `chat-store.ts` never imports this directly; `provider.tsx` bridges
 * `engine.resolve(registry)` into the chat store as a plain async function instead, keeping
 * that file's own dependencies minimal.
 *
 * `toolRegistry`/`toolRuntime` (added in Phase 5) are this provider's isolated frontend tool
 * universe (Section 46, mirroring the same per-provider isolation `registry`/`stateStore`
 * already have) - `useFrontendTool` registers into `toolRegistry`; `toolRuntime` validates
 * and executes a frontend tool call the same way `@gixcopilot/server`'s ToolRuntime executes
 * a backend one (Section 62's zero-trust-for-model-arguments rule applies on both sides).
 */
export interface CopilotInternals {
  readonly registry: ContextRegistry;
  readonly engine: ContextEngine;
  readonly stateStore: CopilotStateStore;
  readonly toolRegistry: ToolRegistry;
  readonly toolRuntime: ToolRuntime;
  /**
   * Generative UI (Phase 6). `generativeComponentRegistry` holds the framework-independent
   * `GenerativeComponentDefinition`s (name/description/propsSchema/metadata) -
   * `useGenerativeComponent` also registers a matching reserved tool into `toolRegistry`
   * above (see `generative-ui-hooks.tsx`), so "the model renders a component" reuses the
   * exact same frontend-tool round trip `useFrontendTool` already established. `componentRenderers`
   * is the plain React-only half a framework-independent registry can never hold: the actual
   * `ComponentType` reference to render once a request resolves. `toolRenderers` backs
   * `useToolRenderer` (Section 27-31) - a custom renderer for *any* tool's activity,
   * independent of whether that tool happens to be generative-UI-related.
   */
  readonly generativeComponentRegistry: GenerativeComponentRegistry;
  readonly componentRenderers: Map<string, ComponentType<Record<string, unknown>>>;
  readonly toolRenderers: Map<string, ToolRenderFn>;
}

export const CopilotInternalsContext = createContext<CopilotInternals | null>(null);

export function useCopilotInternals(): CopilotInternals {
  const internals = useContext(CopilotInternalsContext);
  if (!internals) {
    throw CopilotError.validation(
      'Copilot context/state hooks must be used within CopilotProvider.',
    );
  }
  return internals;
}
