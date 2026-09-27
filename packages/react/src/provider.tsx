'use client';

import { createContext, useContext, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import type { ReactElement } from 'react';
import { createCopilotClient } from '@gixcopilot/client';
import { CopilotError } from '@gixcopilot/protocol';
import type { Thread } from '@gixcopilot/protocol';
import {
  createChatStore,
  createContextMessageResolver,
  createCopilotParts,
  createToolManifestResolver,
} from '@gixcopilot/headless';
import type { ChatStore, ResolveContextMessage, ResolveToolManifest } from '@gixcopilot/headless';
import { CopilotInternalsContext } from './internals.js';
import type { CopilotInternals } from './internals.js';
import type {
  AgentDelegationState,
  AgentHandoffState,
  AgentRunState,
  ApprovalState,
  ChatStatus,
  CopilotAccess,
  CopilotChatResult,
  CopilotMessage,
  CopilotProviderProps,
  ResolvedContextSummary,
  ToolCallState,
  WorkflowRunState,
} from './types.js';

const StoreContext = createContext<ChatStore | null>(null);

/** Own one isolated chat. Changing connection/model/thread configuration resets it. */
export function CopilotProvider({
  children,
  client: suppliedClient,
  runtimeUrl,
  model,
  threadId,
  context,
  getHeaders,
  localToolExecution = false,
}: CopilotProviderProps): ReactElement {
  const headersRef = useRef(getHeaders);
  headersRef.current = getHeaders;
  const client = useMemo(() => {
    if (suppliedClient) return suppliedClient;
    if (!runtimeUrl?.trim())
      throw CopilotError.validation('CopilotProvider requires a client or runtimeUrl.');
    // `getHeaders` is intentionally not a dependency: it's typically a fresh closure every
    // render, and re-creating the client (which would reset the whole chat store) every
    // render just because the caller passed a new function reference would be far worse than
    // keeping the header callback current through its ref.
    return createCopilotClient({ baseUrl: runtimeUrl, getHeaders: () => headersRef.current?.() ?? {} });
  }, [suppliedClient, runtimeUrl]);
  const provider = model?.provider;
  const modelName = model?.model;
  const maxContextTokens = context?.maxContextTokens;
  const dataPolicy = context?.dataPolicy;

  // One isolated context/state universe per provider instance (Section 65) - never a
  // module-level singleton, so sibling/nested CopilotProviders never see each other's
  // context or state.
  // The framework-neutral parts come from @gixcopilot/headless (shared with the Angular
  // adapter); only the React renderer maps are React-specific.
  const internals: CopilotInternals = useMemo(
    () => ({
      ...createCopilotParts({ maxContextTokens, dataPolicy }),
      serverActions: !localToolExecution,
      componentRenderers: new Map(),
      toolRenderers: new Map(),
    }),
    [maxContextTokens, localToolExecution, dataPolicy],
  );
  useEffect(() => () => internals.registry.clear(), [internals]);
  useEffect(() => () => internals.toolRegistry.clear(), [internals]);
  useEffect(() => () => internals.generativeComponentRegistry.clear(), [internals]);

  const resolveContextMessage: ResolveContextMessage = useMemo(() => createContextMessageResolver(internals), [internals]);
  const resolveToolManifest: ResolveToolManifest = useMemo(() => createToolManifestResolver(internals), [internals]);

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

function useStore(): ChatStore {
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

/** Context metadata for the current run, without resolved item content. */
export function useCopilotContextDiagnostics(): ResolvedContextSummary | undefined {
  const store = useStore();
  return useSyncExternalStore(
    store.subscribe,
    () => store.getSnapshot().contextDiagnostics,
    () => store.getServerSnapshot().contextDiagnostics,
  );
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

/**
 * Headless approval state for the current run (Phase 7, Section 81) - a generic timeline any
 * custom/headless UI can render without parsing raw `approval.*` protocol events itself,
 * mirroring `useToolCalls` above. A React default approval component is not mandatory
 * (Section 82) - this hook is the whole contract a custom application needs.
 */
export function useApprovals(): readonly ApprovalState[] {
  const store = useStore();
  return useSyncExternalStore(
    store.subscribe,
    () => store.getSnapshot().approvals,
    () => store.getServerSnapshot().approvals,
  );
}

/** Convenience filter over `useApprovals()` for the common case of "what still needs a
 * decision" (Section 81's `usePendingApprovals`). */
export function usePendingApprovals(): readonly ApprovalState[] {
  return useApprovals().filter((approval) => approval.status === 'pending');
}

/** One approval by id, or `undefined` if it does not exist in the current run (Section 81's
 * `useApproval`). */
export function useApproval(approvalId: string): ApprovalState | undefined {
  return useApprovals().find((approval) => approval.approvalId === approvalId);
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

/**
 * Headless agent-run progress for the current run (Phase 10, Section 141) - every agent run
 * observed so far, including delegated/handed-off children, mirroring `useToolCalls`'
 * "generic timeline any custom UI can render" contract. Structured facts only (Section 18,
 * 140) - never raw model reasoning.
 */
export function useAgentRuns(): readonly AgentRunState[] {
  const store = useStore();
  return useSyncExternalStore(
    store.subscribe,
    () => store.getSnapshot().agentRuns,
    () => store.getServerSnapshot().agentRuns,
  );
}

/** One agent run by its own `agentRunId`, or `undefined` if not (yet) observed - mirrors
 * `useApproval`'s single-item convenience lookup. */
export function useAgentRun(agentRunId: string): AgentRunState | undefined {
  return useAgentRuns().find((run) => run.agentRunId === agentRunId);
}

/** Headless delegation timeline (A -> B -> A, Section 56-58) for the current run. */
export function useAgentDelegations(): readonly AgentDelegationState[] {
  const store = useStore();
  return useSyncExternalStore(
    store.subscribe,
    () => store.getSnapshot().agentDelegations,
    () => store.getServerSnapshot().agentDelegations,
  );
}

/** Headless handoff timeline (A -> B, B becomes active, Section 61-65) for the current run. */
export function useAgentHandoffs(): readonly AgentHandoffState[] {
  const store = useStore();
  return useSyncExternalStore(
    store.subscribe,
    () => store.getSnapshot().agentHandoffs,
    () => store.getServerSnapshot().agentHandoffs,
  );
}

/** Headless workflow-run progress for the current run (Phase 10, Section 141), mirroring
 * `useAgentRuns` - each entry's own `steps` carries per-step status/attempt/phase. */
export function useWorkflowRuns(): readonly WorkflowRunState[] {
  const store = useStore();
  return useSyncExternalStore(
    store.subscribe,
    () => store.getSnapshot().workflowRuns,
    () => store.getServerSnapshot().workflowRuns,
  );
}

/** One workflow run by its own `workflowRunId`, or `undefined` if not (yet) observed. */
export function useWorkflowRun(workflowRunId: string): WorkflowRunState | undefined {
  return useWorkflowRuns().find((run) => run.workflowRunId === workflowRunId);
}
