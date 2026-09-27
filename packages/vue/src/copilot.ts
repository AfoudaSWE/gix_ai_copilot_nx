import { computed, getCurrentInstance, inject, onScopeDispose, provide, shallowRef } from 'vue';
import type { ComponentInternalInstance, ComputedRef, InjectionKey, Plugin, ShallowRef } from 'vue';
import { createCopilotClient } from '@gixcopilot/client';
import type { ClientModelReference, CopilotClient } from '@gixcopilot/client';
import {
  clearCopilotParts,
  createChatStore,
  createContextMessageResolver,
  createCopilotParts,
  createToolManifestResolver,
  toGenerativeUIRequests,
} from '@gixcopilot/headless';
import type {
  AgentRunState,
  ApprovalState,
  ChatSnapshot,
  ChatStatus,
  CopilotContextOptions,
  CopilotMessage,
  CopilotParts,
  GenerativeUIRequestState,
  ToolCallState,
  WorkflowRunState,
} from '@gixcopilot/headless';
import { CopilotError } from '@gixcopilot/protocol';
import type { PublicCopilotError, Thread } from '@gixcopilot/protocol';

/**
 * Configuration for one copilot instance. Exactly one of `endpoint` (the server's base URL,
 * e.g. `/api/copilot`) or an already-constructed `client` is required. Never put provider API
 * keys here: the browser talks only to your server, which owns the model provider.
 */
export type CopilotConfig = {
  readonly model?: ClientModelReference;
  readonly threadId?: string;
  readonly context?: CopilotContextOptions;
  /** Extra headers for every request (e.g. `Authorization`), read on each request. */
  readonly getHeaders?: () => Record<string, string> | Promise<Record<string, string>>;
} & (
  | { readonly endpoint: string; readonly client?: never }
  | { readonly client: CopilotClient; readonly endpoint?: never }
);

/** One copilot: reactive state over the shared headless chat store, plus its actions. */
export interface Copilot {
  readonly client: CopilotClient;
  /** Framework-neutral registries (context, state, tools, generative UI). Advanced use. */
  readonly parts: CopilotParts;
  /** The complete immutable chat snapshot. */
  readonly state: Readonly<ShallowRef<ChatSnapshot>>;
  readonly messages: ComputedRef<readonly CopilotMessage[]>;
  readonly status: ComputedRef<ChatStatus>;
  readonly error: ComputedRef<PublicCopilotError | null>;
  readonly thread: ComputedRef<Thread | null>;
  readonly toolCalls: ComputedRef<readonly ToolCallState[]>;
  readonly approvals: ComputedRef<readonly ApprovalState[]>;
  readonly pendingApprovals: ComputedRef<readonly ApprovalState[]>;
  readonly agentRuns: ComputedRef<readonly AgentRunState[]>;
  readonly workflowRuns: ComputedRef<readonly WorkflowRunState[]>;
  /** True while a turn is being submitted, streamed or waiting for an approval. */
  readonly busy: ComputedRef<boolean>;
  /** Model requests to render registered components (validated props only). */
  readonly generativeUiRequests: ComputedRef<readonly GenerativeUIRequestState[]>;
  /** Sends a user turn. Returns false when blank, busy or disposed (not a failure). */
  sendMessage(text: string): boolean;
  /** Cancels the active run, keeping partial text. */
  stop(): void;
  retry(): boolean;
  regenerate(): boolean;
  /** Cancels and resets local history; does not delete server data. */
  clear(): void;
  /** Records a human decision on a pending approval. The server authorizes the decider. */
  approveAction(approvalId: string, comment?: string): Promise<void>;
  rejectAction(approvalId: string, comment?: string): Promise<void>;
  /** Cancels any active run and releases every registration. */
  dispose(): void;
}

export const COPILOT_KEY: InjectionKey<Copilot> = Symbol('gixcopilot');

/** Vue's inject() only sees ancestors' provides, so remember the one a component provided itself. */
const ownCopilots = new WeakMap<ComponentInternalInstance, Copilot>();

/**
 * Creates a copilot outside of any component (the plugin and `provideCopilot` call this).
 * The caller owns it and must call `dispose()`.
 */
export function createCopilot(config: CopilotConfig): Copilot {
  let client: CopilotClient;
  if (config.client) {
    client = config.client;
  } else {
    if (!config.endpoint?.trim()) throw CopilotError.validation('A copilot requires an endpoint or a client.');
    const getHeaders = config.getHeaders;
    client = createCopilotClient({ baseUrl: config.endpoint, getHeaders: () => getHeaders?.() ?? {} });
  }
  const parts = createCopilotParts(config.context);
  const store = createChatStore(
    client,
    config.model,
    config.threadId,
    createContextMessageResolver(parts),
    createToolManifestResolver(parts),
    parts.toolRuntime,
  );
  const state = shallowRef<ChatSnapshot>(store.getSnapshot());
  const unsubscribe = store.subscribe(() => {
    state.value = store.getSnapshot();
  });
  store.mount();

  const registry = parts.generativeComponentRegistry;
  let disposed = false;
  return {
    client,
    parts,
    state,
    messages: computed(() => state.value.messages),
    status: computed(() => state.value.status),
    error: computed(() => state.value.error),
    thread: computed(() => state.value.thread),
    toolCalls: computed(() => state.value.toolCalls),
    approvals: computed(() => state.value.approvals),
    pendingApprovals: computed(() => state.value.approvals.filter((approval) => approval.status === 'pending')),
    agentRuns: computed(() => state.value.agentRuns),
    workflowRuns: computed(() => state.value.workflowRuns),
    busy: computed(() => {
      const status = state.value.status;
      return status === 'submitting' || status === 'streaming' || status === 'waiting_for_approval';
    }),
    generativeUiRequests: computed(() => toGenerativeUIRequests(state.value.toolCalls, registry)),
    sendMessage: (text) => store.access.sendMessage(text),
    stop: () => store.access.stop(),
    retry: () => store.access.retry(),
    regenerate: () => store.access.regenerate(),
    clear: () => store.access.clear(),
    approveAction: (approvalId, comment) => store.access.approveAction(approvalId, comment),
    rejectAction: (approvalId, comment) => store.access.rejectAction(approvalId, comment),
    dispose: () => {
      if (disposed) return;
      disposed = true;
      unsubscribe();
      store.dispose();
      clearCopilotParts(parts);
    },
  };
}

/**
 * App-wide copilot: `app.use(createCopilotPlugin({ endpoint: '/api/copilot' }))`. Disposed when
 * the app unmounts.
 */
export function createCopilotPlugin(config: CopilotConfig): Plugin {
  return {
    install(app) {
      const copilot = createCopilot(config);
      app.provide(COPILOT_KEY, copilot);
      app.onUnmount(() => copilot.dispose());
    },
  };
}

/**
 * Provides a copilot to the current component's subtree (call in `setup()`); disposed with the
 * component. Use this for several independent copilots on one page.
 */
export function provideCopilot(config: CopilotConfig): Copilot {
  const copilot = createCopilot(config);
  provide(COPILOT_KEY, copilot);
  const instance = getCurrentInstance();
  if (instance) ownCopilots.set(instance, copilot);
  onScopeDispose(() => copilot.dispose());
  return copilot;
}

/** The nearest provided copilot (including one provided by this component). Call in `setup()`. */
export function useCopilot(): Copilot {
  const instance = getCurrentInstance();
  const copilot = (instance && ownCopilots.get(instance)) ?? inject(COPILOT_KEY, null);
  if (!copilot) throw CopilotError.validation('No copilot provided: app.use(createCopilotPlugin(...)) or provideCopilot(...) first.');
  return copilot;
}
