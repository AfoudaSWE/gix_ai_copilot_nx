'use client';

import { createContext, useContext, useEffect, useMemo, useSyncExternalStore } from 'react';
import type { ReactElement } from 'react';
import { createCopilotClient } from '@gixcopilot/client';
import { CopilotError } from '@gixcopilot/protocol';
import type { Thread } from '@gixcopilot/protocol';
import { createContextEngine, createContextRegistry, createCopilotStateStore } from '@gixcopilot/context';
import { createDefaultToolResolver, createToolRegistry, createToolRuntime, isToolEnabled, toToolManifest } from '@gixcopilot/tools';
import { createChatStore } from './chat-store.js';
import type { ResolveContextMessage, ResolveToolManifest } from './chat-store.js';
import { CopilotInternalsContext } from './internals.js';
import type { CopilotInternals } from './internals.js';
import type {
  ChatStatus,
  CopilotAccess,
  CopilotChatResult,
  CopilotMessage,
  CopilotProviderProps,
  ToolCallState,
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
  const internals: CopilotInternals = useMemo(() => {
    const toolRegistry = createToolRegistry();
    return {
      registry: createContextRegistry(),
      engine: createContextEngine({ maxContextTokens }),
      stateStore: createCopilotStateStore(),
      toolRegistry,
      toolRuntime: createToolRuntime({ resolver: createDefaultToolResolver(toolRegistry) }),
    };
  }, [maxContextTokens]);
  useEffect(() => () => internals.registry.clear(), [internals]);
  useEffect(() => () => internals.toolRegistry.clear(), [internals]);

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

  const resolveToolManifest: ResolveToolManifest = useMemo(
    () => () => {
      const enabledTools = internals.toolRegistry.list().filter(isToolEnabled);
      // `undefined` (not an empty array) when nothing is registered, matching
      // resolveContextMessage's "send exactly what Phase 4 always sent" convention -
      // @gixcopilot/client omits the `tools` field entirely in that case (Section 64).
      return enabledTools.length === 0 ? undefined : toToolManifest(enabledTools);
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
        resolveToolManifest,
        internals.toolRuntime,
      ),
    [client, provider, modelName, threadId, resolveContextMessage, resolveToolManifest, internals],
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

/**
 * Headless tool activity for the current run (Section 61, added in Phase 5) - a generic
 * timeline any custom UI can render without parsing raw `tool.*` protocol events itself.
 * `CopilotChat`'s default rendering (see `@gixcopilot/ui`) is built on this same state.
 */
export function useToolCalls(): readonly ToolCallState[] {
  const store = useStore();
  return useSyncExternalStore(
    store.subscribe,
    () => store.getSnapshot().toolCalls,
    () => store.getServerSnapshot().toolCalls,
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
