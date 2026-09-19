'use client';

import { createContext, useContext } from 'react';
import { CopilotError } from '@gixcopilot/protocol';
import type { ContextEngine, ContextRegistry, CopilotStateStore } from '@gixcopilot/context';

/**
 * Per-`CopilotProvider` instance context/state universe (Section 65 - isolated, not a
 * global singleton). `chat-store.ts` never imports this directly; `provider.tsx` bridges
 * `engine.resolve(registry)` into the chat store as a plain async function instead, keeping
 * that file's own dependencies minimal.
 */
export interface CopilotInternals {
  readonly registry: ContextRegistry;
  readonly engine: ContextEngine;
  readonly stateStore: CopilotStateStore;
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
