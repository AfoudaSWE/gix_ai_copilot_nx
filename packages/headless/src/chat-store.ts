import type { ClientModelReference, ClientRun, CopilotClient } from '@gixcopilot/client';
import { CopilotError, createMessageId, createThreadId } from '@gixcopilot/protocol';
import type { CopilotEvent, PublicCopilotError, ToolResult, ToolManifestEntry } from '@gixcopilot/protocol';
import type { ToolRuntime } from '@gixcopilot/tools';
import type { ResolvedContext } from '@gixcopilot/context';
import type {
  AgentHandoffState,
  AgentRunState,
  ApprovalState,
  ChatSnapshot,
  CopilotAccess,
  CopilotMessage,
  ResolvedContextSummary,
  ToolCallState,
  WorkflowRunState,
  WorkflowStepState,
} from './types.js';

interface ActiveRun {
  readonly action?: { readonly name: string; readonly arguments: Readonly<Record<string, unknown>> };
  resolveAction?: (result: ToolResult) => void;
  handle?: ClientRun;
  runId?: string;
  sequence: number;
  /** Per-run-attempt map of in-flight frontend tool executions (Section 48, 85), so
   * stopping/replacing the run aborts any tool call still running in the browser instead of
   * leaving it to finish pointlessly (its result would never be submitted anywhere useful). */
  readonly frontendToolControllers: Map<string, AbortController>;
}

/**
 * Builds the frontend tool manifest to advertise on this run (Section 45-46), or `undefined`
 * when nothing is registered - mirrors `ResolveContextMessage`'s "send exactly what Phase 4
 * always sent when there's nothing to add" convention (Section 64).
 */
export type ResolveToolManifest = () => readonly ToolManifestEntry[] | undefined;

/**
 * A framework-independent chat store: an immutable snapshot plus subscribe/getSnapshot, the
 * shape both React's `useSyncExternalStore` and an Angular signal bridge consume. Transport and
 * runtime behavior stay in `@gixcopilot/client`; this only projects client runs into state.
 */
export interface ChatStore {
  readonly access: CopilotAccess;
  readonly getSnapshot: () => ChatSnapshot;
  readonly getServerSnapshot: () => ChatSnapshot;
  readonly subscribe: (listener: () => void) => () => void;
  readonly mount: () => void;
  readonly dispose: () => void;
}

/**
 * Resolves Phase 4 application context (if any) to prepend its content as
 * a leading `system` message, or `undefined` when there is nothing to add - so a provider
 * with no registered context sends exactly the same request Phase 3 always sent (Section
 * 64). The provider bridges its context engine into this function (Section 33's
 * "structured system message" placement decision - see
 * docs/adr/0009-context-and-state-architecture.md).
 *
 * May return synchronously (`undefined`, when nothing is registered) instead of a `Promise`
 * - `consume()` only `await`s when it actually gets one, so a provider with zero context
 * items dispatches `client.run()` on the exact same tick Phase 3 always did, not one
 * microtask later.
 */
export type ResolveContextMessage = () => Promise<ResolvedContext | undefined> | ResolvedContext | undefined;

function summarizeContext(resolved: ResolvedContext): ResolvedContextSummary {
  return {
    items: resolved.items.map(({ id, name, scope, priority, sensitivity, estimatedTokens, truncated }) =>
      ({ id, name, scope, priority, sensitivity, estimatedTokens, truncated })),
    excluded: resolved.excluded.map(({ id, name, scope, reason }) => ({ id, name, scope, reason })),
    estimatedTokens: resolved.estimatedTokens,
    diagnostics: { ...resolved.diagnostics },
  };
}

/** Creates the chat store for one copilot instance. Call `mount()` when it becomes active and
 * `dispose()` when its owner is destroyed (cancels any active run). */
export function createChatStore(
  client: CopilotClient,
  model?: ClientModelReference,
  threadId?: string,
  resolveContextMessage?: ResolveContextMessage,
  resolveToolManifest?: ResolveToolManifest,
  toolRuntime?: ToolRuntime,
): ChatStore {
  const initial: ChatSnapshot = {
    messages: [],
    thread: null,
    runId: null,
    status: 'idle',
    error: null,
    usage: undefined,
    finishReason: undefined,
    toolCalls: [],
    approvals: [],
    agentRuns: [],
    agentDelegations: [],
    agentHandoffs: [],
    workflowRuns: [],
  };
  let state: ChatSnapshot = initial;
  let active: ActiveRun | undefined;
  let enabled = true;
  let replay: readonly CopilotMessage[] | undefined;
  const listeners = new Set<() => void>();

  function publish(next: ChatSnapshot): void {
    state = next;
    for (const listener of listeners) listener();
  }

  function seal(status: CopilotMessage['status']): readonly CopilotMessage[] {
    return state.messages.map((message) =>
      message.status === 'streaming' ? { ...message, status } : message,
    );
  }

  function fail(error: PublicCopilotError): void {
    publish({ ...state, messages: seal('error'), status: 'error', error });
  }

  function textOfContent(content: CopilotMessage['content']): string {
    return content
      .filter((part): part is Extract<typeof part, { type: 'text' }> => part.type === 'text')
      .map((part) => part.text)
      .join('');
  }

  function updateToolCall(id: string, patch: Partial<ToolCallState>): void {
    publish({
      ...state,
      toolCalls: state.toolCalls.map((toolCall) =>
        toolCall.id === id ? { ...toolCall, ...patch } : toolCall,
      ),
    });
  }

  function updateApproval(approvalId: string, patch: Partial<ApprovalState>): void {
    publish({
      ...state,
      approvals: state.approvals.map((approval) =>
        approval.approvalId === approvalId ? { ...approval, ...patch } : approval,
      ),
    });
  }

  function updateAgentRun(agentRunId: string, patch: Partial<AgentRunState>): void {
    publish({
      ...state,
      agentRuns: state.agentRuns.map((run) => (run.agentRunId === agentRunId ? { ...run, ...patch } : run)),
    });
  }

  /** A workflow run is created lazily on its first observed event, then patched/merged - a
   * client run may never involve a workflow at all (the common case), so nothing is
   * pre-allocated (mirrors `agentRuns`/`toolCalls` only ever growing on a real event). */
  function upsertWorkflowRun(
    workflowRunId: string,
    build: (existing: WorkflowRunState | undefined) => WorkflowRunState,
  ): void {
    const existing = state.workflowRuns.find((run) => run.workflowRunId === workflowRunId);
    const next = build(existing);
    publish({
      ...state,
      workflowRuns: existing
        ? state.workflowRuns.map((run) => (run.workflowRunId === workflowRunId ? next : run))
        : [...state.workflowRuns, next],
    });
  }

  function upsertWorkflowStep(workflowRunId: string, patch: WorkflowStepState): void {
    upsertWorkflowRun(workflowRunId, (existing) => {
      const base: WorkflowRunState = existing ?? {
        workflowRunId,
        workflowId: '',
        status: 'running',
        steps: [],
      };
      const hasStep = base.steps.some((step) => step.stepId === patch.stepId && step.phase === patch.phase);
      return {
        ...base,
        steps: hasStep
          ? base.steps.map((step) => (step.stepId === patch.stepId && step.phase === patch.phase ? patch : step))
          : [...base.steps, patch],
      };
    });
  }

  /**
   * Executes a browser-registered frontend tool for a `tool.requested` event with
   * `source: 'frontend'` (Section 45, 58), then reports the outcome back to the server
   * (Section 50) so its suspended Model -> Tool -> Model loop can resume. Never throws -
   * `toolRuntime.execute()` already normalizes every failure mode (unregistered tool,
   * invalid arguments, a thrown error) into a `ToolResult`, which is what gets submitted
   * either way.
   */
  async function executeFrontendTool(
    event: Extract<CopilotEvent, { type: 'tool.requested' }>,
    token: ActiveRun,
  ): Promise<void> {
    if (!toolRuntime) return;
    const controller = new AbortController();
    token.frontendToolControllers.set(event.toolCallId, controller);
    try {
      const result = await toolRuntime.execute({
        toolCallId: event.toolCallId,
        name: event.name,
        arguments: event.arguments,
        context: { runId: event.runId, signal: controller.signal },
      });
      await client.submitToolResult(event.runId, event.toolCallId, result);
    } catch {
      // The server's own frontendToolTimeoutMs (Section 51) is the safety net if this
      // submission itself fails (e.g. the network dropped) - nothing further to do here.
    } finally {
      token.frontendToolControllers.delete(event.toolCallId);
    }
  }

  function receive(event: CopilotEvent, token: ActiveRun): void {
    if (event.threadId !== state.thread?.id) return;
    if (!token.runId) {
      if (event.type !== 'run.started' && event.type !== 'run.cancelled') return;
      token.runId = event.runId;
    }
    if (event.runId !== token.runId || event.sequence <= token.sequence) return;
    token.sequence = event.sequence;
    switch (event.type) {
      case 'run.started':
        publish({ ...state, runId: event.runId });
        break;
      case 'message.started':
        if (state.messages.some((message) => message.id === event.messageId)) return;
        publish({
          ...state,
          messages: [
            ...state.messages,
            {
              id: event.messageId,
              threadId: event.threadId,
              createdAt: event.timestamp,
              role: event.role,
              content: [],
              status: 'streaming',
            },
          ],
        });
        break;
      case 'message.delta':
        publish({
          ...state,
          status: 'streaming',
          error: null,
          messages: state.messages.map((message) =>
            message.id === event.messageId && message.status === 'streaming'
              ? {
                  ...message,
                  content: [
                    {
                      type: 'text',
                      text: textOfContent(message.content) + event.delta,
                    },
                  ],
                }
              : message,
          ),
        });
        break;
      case 'message.end':
        publish({
          ...state,
          messages: state.messages.map((message) =>
            message.id === event.messageId
              ? { ...message, content: event.content, status: 'complete' }
              : message,
          ),
        });
        break;
      case 'run.completed':
        active = undefined;
        publish({
          ...state,
          messages: seal('complete'),
          status: 'completed',
          error: null,
          usage: event.usage,
          finishReason: event.finishReason,
        });
        break;
      case 'run.cancelled':
        active = undefined;
        publish({
          ...state,
          messages: seal('stopped'),
          status: 'stopped',
          error: null,
          finishReason: 'cancelled',
        approvals: state.approvals.map((approval) => approval.status === 'pending' ? { ...approval, status: 'cancelled' as const } : approval),
        agentRuns: state.agentRuns.map((run) => (run.status === 'running' ? { ...run, status: 'cancelled' as const } : run)),
        workflowRuns: state.workflowRuns.map((run) =>
          run.status === 'running' || run.status === 'paused' ? { ...run, status: 'cancelled' as const } : run,
        ),
        });
        break;
      case 'run.failed':
      case 'error':
        active = undefined;
        fail(event.error);
        break;
      case 'tool.requested':
        if (state.toolCalls.some((toolCall) => toolCall.id === event.toolCallId)) return;
        publish({
          ...state,
          toolCalls: [
            ...state.toolCalls,
            {
              id: event.toolCallId,
              name: event.name,
              source: event.source,
              status: 'requested',
              arguments: event.arguments,
            },
          ],
        });
        if (event.source === 'frontend') {
          void executeFrontendTool(event, token);
        }
        break;
      case 'tool.started':
        updateToolCall(event.toolCallId, { status: 'running' });
        break;
      case 'tool.completed':
        token.resolveAction?.({ status: 'success', toolCallId: event.toolCallId, data: event.result });
        token.resolveAction = undefined;
        updateToolCall(event.toolCallId, { status: 'succeeded', result: event.result });
        break;
      case 'tool.failed':
        token.resolveAction?.({ status: 'error', toolCallId: event.toolCallId, error: event.error });
        token.resolveAction = undefined;
        updateToolCall(event.toolCallId, { status: 'failed', error: event.error });
        break;
      case 'approval.requested':
        if (state.approvals.some((approval) => approval.approvalId === event.approvalId)) return;
        publish({
          ...state,
          status: 'waiting_for_approval',
          error: null,
          approvals: [
            ...state.approvals,
            {
              approvalId: event.approvalId,
              toolCallId: event.toolCallId,
              action: event.action,
              approvalLevel: event.approvalLevel,
              summary: event.summary,
              status: 'pending',
              risk: event.risk,
              reversibility: event.reversibility,
              expiresAt: event.expiresAt,
              preview: event.preview,
            },
          ],
        });
        break;
      case 'approval.approved':
        updateApproval(event.approvalId, { status: 'approved', decidedBy: event.decidedBy });
        break;
      case 'approval.rejected':
        updateApproval(event.approvalId, { status: 'rejected', decidedBy: event.decidedBy });
        break;
      case 'approval.expired':
        updateApproval(event.approvalId, { status: 'expired' });
        break;
      // Agent/workflow events, added in Phase 10 (Section 139-143) - structured facts only
      // (Section 18, 140: no chain-of-thought), reusing the exact same event stream every
      // other case in this switch already consumes; a client with no agent/workflow-aware
      // backend simply never sees these event types at all.
      case 'agent.run.started':
        if (state.agentRuns.some((run) => run.agentRunId === event.agentRunId)) return;
        publish({
          ...state,
          agentRuns: [
            ...state.agentRuns,
            {
              agentRunId: event.agentRunId,
              agentId: event.agentId,
              rootRunId: event.rootRunId,
              parentRunId: event.parentRunId,
              status: 'running',
            },
          ],
        });
        break;
      case 'agent.run.completed':
        updateAgentRun(event.agentRunId, { status: 'completed' });
        break;
      case 'agent.run.failed':
        updateAgentRun(event.agentRunId, { status: 'failed', error: event.error });
        break;
      case 'agent.run.cancelled':
        updateAgentRun(event.agentRunId, { status: 'cancelled' });
        break;
      case 'agent.delegation.started':
        if (state.agentDelegations.some((delegation) => delegation.delegationId === event.delegationId)) return;
        publish({
          ...state,
          agentDelegations: [
            ...state.agentDelegations,
            {
              delegationId: event.delegationId,
              fromAgentId: event.fromAgentId,
              toAgentId: event.toAgentId,
              depth: event.depth,
              status: 'started',
            },
          ],
        });
        break;
      case 'agent.delegation.completed':
        publish({
          ...state,
          agentDelegations: state.agentDelegations.map((delegation) =>
            delegation.delegationId === event.delegationId
              ? { ...delegation, status: event.status, error: event.error }
              : delegation,
          ),
        });
        break;
      case 'agent.handoff': {
        const handoff: AgentHandoffState = {
          fromAgentId: event.fromAgentId,
          toAgentId: event.toAgentId,
          reason: event.reason,
        };
        publish({ ...state, agentHandoffs: [...state.agentHandoffs, handoff] });
        break;
      }
      case 'agent.routing.decided':
        // Auditable (Section 47, 51, 182), but not yet surfaced through a dedicated headless
        // hook - no UI requirement in this phase reads it. Recorded nowhere client-side for
        // now; a future consumer can add a hook the same way this file's other cases do.
        break;
      case 'workflow.run.started':
        upsertWorkflowRun(event.workflowRunId, () => ({
          workflowRunId: event.workflowRunId,
          workflowId: event.workflowId,
          status: 'running',
          steps: [],
        }));
        break;
      case 'workflow.run.paused':
        upsertWorkflowRun(event.workflowRunId, (existing) => ({
          ...(existing ?? { workflowRunId: event.workflowRunId, workflowId: event.workflowId, steps: [] }),
          status: 'paused',
          pauseReason: event.reason,
          pausedStepId: event.stepId,
        }));
        break;
      case 'workflow.run.resumed':
        upsertWorkflowRun(event.workflowRunId, (existing) => ({
          ...(existing ?? { workflowRunId: event.workflowRunId, workflowId: event.workflowId, steps: [] }),
          status: 'running',
          pauseReason: undefined,
          pausedStepId: undefined,
        }));
        break;
      case 'workflow.run.completed':
        upsertWorkflowRun(event.workflowRunId, (existing) => ({
          ...(existing ?? { workflowRunId: event.workflowRunId, workflowId: event.workflowId, steps: [] }),
          status: 'completed',
        }));
        break;
      case 'workflow.run.failed':
        upsertWorkflowRun(event.workflowRunId, (existing) => ({
          ...(existing ?? { workflowRunId: event.workflowRunId, workflowId: event.workflowId, steps: [] }),
          status: 'failed',
          error: event.error,
        }));
        break;
      case 'workflow.run.cancelled':
        upsertWorkflowRun(event.workflowRunId, (existing) => ({
          ...(existing ?? { workflowRunId: event.workflowRunId, workflowId: event.workflowId, steps: [] }),
          status: 'cancelled',
        }));
        break;
      case 'workflow.step.started':
        upsertWorkflowStep(event.workflowRunId, {
          stepId: event.stepId,
          stepType: event.stepType,
          status: 'running',
          attempt: event.attempt,
          phase: event.phase,
        });
        break;
      case 'workflow.step.completed':
        upsertWorkflowStep(event.workflowRunId, {
          stepId: event.stepId,
          stepType:
            state.workflowRuns
              .find((run) => run.workflowRunId === event.workflowRunId)
              ?.steps.find((step) => step.stepId === event.stepId && step.phase === event.phase)?.stepType ??
            'function',
          status: 'completed',
          attempt: event.attempt,
          phase: event.phase,
        });
        break;
      case 'workflow.step.failed':
        upsertWorkflowStep(event.workflowRunId, {
          stepId: event.stepId,
          stepType:
            state.workflowRuns
              .find((run) => run.workflowRunId === event.workflowRunId)
              ?.steps.find((step) => step.stepId === event.stepId && step.phase === event.phase)?.stepType ??
            'function',
          status: 'failed',
          attempt: event.attempt,
          phase: event.phase,
          error: event.error,
          willRetry: event.willRetry,
        });
        break;
      case 'workflow.checkpoint.saved':
        // The resumability audit trail (Section 100) - not yet surfaced through a dedicated
        // headless hook, same posture as 'agent.routing.decided' above.
        break;
    }
  }

  async function consume(token: ActiveRun, history: readonly CopilotMessage[]): Promise<void> {
    try {
      if (active !== token || !enabled) return;
      const contextResult = resolveContextMessage?.();
      const resolvedContext = contextResult instanceof Promise ? await contextResult : contextResult;
      if (active !== token) return; // Re-check: stop()/a new send may have run during the await.
      if (resolvedContext) publish({ ...state, contextDiagnostics: summarizeContext(resolvedContext) });
      const contextContent = resolvedContext?.content;
      const historyMessages = history.map(({ role, content }) => ({ role, content }));
      const messages = contextContent
        ? [{ role: 'system' as const, content: [{ type: 'text' as const, text: contextContent }] }, ...historyMessages]
        : historyMessages;
      token.handle = client.run({
        threadId: state.thread?.id,
        model,
        messages,
        tools: resolveToolManifest?.(),
        action: token.action,
      });
      if (active !== token) return;
      for await (const event of token.handle.events) {
        if (active !== token) break;
        receive(event, token);
        if (active !== token) break;
      }
      if (active === token) {
        active = undefined;
        fail(CopilotError.transport('The response ended before completion.').toPublicJSON());
      }
    } catch (error) {
      if (active === token) {
        active = undefined;
        fail(
          (CopilotError.isCopilotError(error)
            ? error
            : CopilotError.transport('Unable to complete the request.', error)
          ).toPublicJSON(),
        );
      }
    } finally {
      token.resolveAction?.({ status: 'error', toolCallId: 'cancelled', error: CopilotError.cancelled().toPublicJSON() });
      token.resolveAction = undefined;
      token.handle?.cancel();
      abortFrontendToolCalls(token);
    }
  }

  function abortFrontendToolCalls(token: ActiveRun): void {
    for (const controller of token.frontendToolControllers.values()) {
      controller.abort();
    }
    token.frontendToolControllers.clear();
  }

  function start(history: readonly CopilotMessage[], action?: ActiveRun["action"], resolveAction?: ActiveRun["resolveAction"]): boolean {
    if (active || !enabled) return false;
    const token: ActiveRun = { sequence: 0, frontendToolControllers: new Map(), action, resolveAction };
    active = token;
    replay = history;
    publish({
      ...state,
      messages: history,
      status: 'submitting',
      error: null,
      runId: null,
      usage: undefined,
      finishReason: undefined,
      contextDiagnostics: undefined,
      toolCalls: [],
      approvals: [],
      agentRuns: [],
      agentDelegations: [],
      agentHandoffs: [],
      workflowRuns: [],
    });
    void consume(token, history);
    return true;
  }

  const access: CopilotAccess = {
    client,
    invokeTool(name, args) {
      return new Promise<ToolResult>((resolve) => {
        const accepted = start(state.messages.length ? state.messages : [{
          id: createMessageId(), threadId: state.thread?.id ?? createThreadId(), role: 'user',
          content: [{ type: 'text', text: `Requested action: ${name}` }],
          createdAt: new Date().toISOString(), status: 'complete',
        }], { name, arguments: args }, resolve);
        if (!accepted) resolve({ status: 'error', toolCallId: 'busy', error: CopilotError.validation('A run is already active.').toPublicJSON() });
      });
    },
    sendMessage(text) {
      if (!text.trim() || active || !enabled) return false;
      const thread = state.thread ?? {
        id: threadId ?? createThreadId(),
        createdAt: new Date().toISOString(),
      };
      const message: CopilotMessage = {
        id: createMessageId(),
        threadId: thread.id,
        role: 'user',
        content: [{ type: 'text', text }],
        createdAt: new Date().toISOString(),
        status: 'complete',
      };
      state = { ...state, thread };
      return start([...state.messages, message]);
    },
    stop() {
      const token = active;
      if (!token) return;
      active = undefined; // Invalidate BEFORE abort: late events cannot touch the next run.
      token.handle?.cancel();
      abortFrontendToolCalls(token);
      publish({
        ...state,
        messages: seal('stopped'),
        status: 'stopped',
        error: null,
        finishReason: 'cancelled',
        approvals: state.approvals.map((approval) => approval.status === 'pending' ? { ...approval, status: 'cancelled' as const } : approval),
        agentRuns: state.agentRuns.map((run) => (run.status === 'running' ? { ...run, status: 'cancelled' as const } : run)),
        workflowRuns: state.workflowRuns.map((run) =>
          run.status === 'running' || run.status === 'paused' ? { ...run, status: 'cancelled' as const } : run,
        ),
      });
    },
    retry: () => state.status === 'error' && replay !== undefined && start(replay),
    regenerate: () =>
      (state.status === 'completed' || state.status === 'stopped') &&
      replay !== undefined &&
      start(replay),
    clear() {
      access.stop();
      replay = undefined;
      publish(initial);
    },
    approveAction: (approvalId, comment) => client.decideApproval(approvalId, 'approve', comment),
    rejectAction: (approvalId, comment) => client.decideApproval(approvalId, 'reject', comment),
  };

  return {
    access,
    getSnapshot: () => state,
    getServerSnapshot: () => initial,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    mount() {
      enabled = true;
    },
    dispose() {
      enabled = false;
      access.stop();
    },
  };
}
