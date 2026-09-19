'use client';

import { createContext, useContext } from 'react';
import { CopilotError } from '@gixcopilot/protocol';
import type { ContextEngine, ContextRegistry, CopilotStateStore } from '@gixcopilot/context';
import type { ToolRegistry, ToolRuntime } from '@gixcopilot/tools';

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
