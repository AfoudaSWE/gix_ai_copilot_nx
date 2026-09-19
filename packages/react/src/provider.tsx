'use client';

import { createContext, useContext, useEffect, useMemo, useSyncExternalStore } from 'react';
import type { ReactElement } from 'react';
import { createCopilotClient } from '@gixcopilot/client';
import { CopilotError } from '@gixcopilot/protocol';
import type { Thread } from '@gixcopilot/protocol';
import { createChatStore } from './chat-store.js';
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
}: CopilotProviderProps): ReactElement {
  const client = useMemo(() => {
    if (suppliedClient) return suppliedClient;
    if (!runtimeUrl?.trim())
      throw CopilotError.validation('CopilotProvider requires a client or runtimeUrl.');
    return createCopilotClient({ baseUrl: runtimeUrl });
  }, [suppliedClient, runtimeUrl]);
  const provider = model?.provider;
  const modelName = model?.model;
  const store = useMemo(
    () =>
      createChatStore(
        client,
        provider !== undefined && modelName !== undefined
          ? { provider, model: modelName }
          : undefined,
        threadId,
      ),
    [client, provider, modelName, threadId],
  );
  useEffect(() => {
    store.mount();
    return () => store.dispose();
  }, [store]);
  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
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
