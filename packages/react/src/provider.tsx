'use client';

import { createContext, useContext, useEffect, useMemo, useSyncExternalStore } from 'react';
import type { ReactElement } from 'react';
import { createCopilotClient } from '@gixcopilot/client';
import { CopilotError } from '@gixcopilot/protocol';
import type { Thread } from '@gixcopilot/protocol';
import { createContextEngine, createContextRegistry, createCopilotStateStore } from '@gixcopilot/context';
import { createChatStore } from './chat-store.js';
import type { ResolveContextMessage } from './chat-store.js';
import { CopilotInternalsContext } from './internals.js';
import type { CopilotInternals } from './internals.js';
import type {
  ChatStatus,
  CopilotAccess,
  CopilotChatResult,
  CopilotMessage,
  CopilotProviderProps,
} from './types.js';

const StoreContext = createContext<ReturnType<typeof createChatStore> | null>(null);

/** Own one isolated chat. Changing connection/model/thread configuration resets it. */
export function CopilotProvider({
  children,
  client: suppliedClient,
  runtimeUrl,
  model,
  threadId,
  context,
}: CopilotProviderProps): ReactElement {
  const client = useMemo(() => {
    if (suppliedClient) return suppliedClient;
    if (!runtimeUrl?.trim())
      throw CopilotError.validation('CopilotProvider requires a client or runtimeUrl.');
    return createCopilotClient({ baseUrl: runtimeUrl });
  }, [suppliedClient, runtimeUrl]);
  const provider = model?.provider;
  const modelName = model?.model;
  const maxContextTokens = context?.maxContextTokens;

  // One isolated context/state universe per provider instance (Section 65) - never a
  // module-level singleton, so sibling/nested CopilotProviders never see each other's
  // context or state.
  const internals: CopilotInternals = useMemo(
    () => ({
      registry: createContextRegistry(),
      engine: createContextEngine({ maxContextTokens }),
      stateStore: createCopilotStateStore(),
    }),
    [maxContextTokens],
  );
  useEffect(() => () => internals.registry.clear(), [internals]);

  const resolveContextMessage: ResolveContextMessage = useMemo(
    () => () => {
      // Fast, fully synchronous path when nothing is registered (the common Phase 3 case):
      // no promise, no microtask, `client.run()` dispatches on the same tick it always did.
      if (internals.registry.list({ enabledOnly: true }).length === 0) return undefined;
      return internals.engine
        .resolve(internals.registry)
        .then((resolved) => resolved.content || undefined);
    },
    [internals],
  );

  const store = useMemo(
    () =>
      createChatStore(
        client,
        provider !== undefined && modelName !== undefined
          ? { provider, model: modelName }
          : undefined,
        threadId,
        resolveContextMessage,
      ),
    [client, provider, modelName, threadId, resolveContextMessage],
  );
  useEffect(() => {
    store.mount();
    return () => store.dispose();
  }, [store]);
  return (
    <CopilotInternalsContext.Provider value={internals}>
      <StoreContext.Provider value={store}>{children}</StoreContext.Provider>
    </CopilotInternalsContext.Provider>
  );
}

function useStore(): ReturnType<typeof createChatStore> {
  const store = useContext(StoreContext);
  if (!store) throw CopilotError.validation('Copilot hooks must be used within CopilotProvider.');
  return store;
}

/** Access the client and stable actions without subscribing to chat updates. */
export function useCopilot(): CopilotAccess {
  return useStore().access;
}

/** Subscribe to the complete local chat state; usable without any UI package. */
export function useCopilotChat(): CopilotChatResult {
  const store = useStore();
  const snapshot = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getServerSnapshot,
  );
  return { ...snapshot, ...store.access };
}

/** Subscribe only to message changes. */
export function useMessages(): readonly CopilotMessage[] {
  const store = useStore();
  return useSyncExternalStore(
    store.subscribe,
    () => store.getSnapshot().messages,
    () => store.getServerSnapshot().messages,
  );
}

/** Subscribe to status transitions without rerendering for each delta. */
export function useCopilotStatus(): ChatStatus {
  const store = useStore();
  return useSyncExternalStore(
    store.subscribe,
    () => store.getSnapshot().status,
    () => store.getServerSnapshot().status,
  );
}

/** Local ephemeral thread, created on first send; not persistent conversation storage. */
export function useThread(): Thread | null {
  const store = useStore();
  return useSyncExternalStore(
    store.subscribe,
    () => store.getSnapshot().thread,
    () => store.getServerSnapshot().thread,
  );
}
