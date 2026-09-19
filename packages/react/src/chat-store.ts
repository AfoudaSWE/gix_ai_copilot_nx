import type { ClientModelReference, ClientRun, CopilotClient } from '@gixcopilot/client';
import { CopilotError, createMessageId, createThreadId } from '@gixcopilot/protocol';
import type { CopilotEvent, PublicCopilotError, ToolManifestEntry } from '@gixcopilot/protocol';
import type { ToolRuntime } from '@gixcopilot/tools';
import type { ChatSnapshot, CopilotAccess, CopilotMessage, ToolCallState } from './types.js';

interface ActiveRun {
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

interface ChatStore {
  readonly access: CopilotAccess;
  readonly getSnapshot: () => ChatSnapshot;
  readonly getServerSnapshot: () => ChatSnapshot;
  readonly subscribe: (listener: () => void) => () => void;
  readonly mount: () => void;
  readonly dispose: () => void;
}

/**
 * Resolves Phase 4 application context (if any) into a single content string to prepend as
 * a leading `system` message, or `undefined` when there is nothing to add - so a provider
 * with no registered context sends exactly the same request Phase 3 always sent (Section
 * 64). Deliberately typed as a plain function, not a `@gixcopilot/context` type: this file
 * stays free of any context-package import, and `provider.tsx` is the only place that
 * bridges the two (Section 33's "structured system message" placement decision - see
 * docs/adr/0009-context-and-state-architecture.md).
 *
 * May return synchronously (`undefined`, when nothing is registered) instead of a `Promise`
 * - `consume()` only `await`s when it actually gets one, so a provider with zero context
 * items dispatches `client.run()` on the exact same tick Phase 3 always did, not one
 * microtask later.
 */
export type ResolveContextMessage = () => Promise<string | undefined> | string | undefined;

/** Internal presentation store. Transport and runtime behavior stay in the client. */
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
        updateToolCall(event.toolCallId, { status: 'succeeded', result: event.result });
        break;
      case 'tool.failed':
        updateToolCall(event.toolCallId, { status: 'failed', error: event.error });
        break;
    }
  }

  async function consume(token: ActiveRun, history: readonly CopilotMessage[]): Promise<void> {
    try {
      if (active !== token || !enabled) return;
      const contextResult = resolveContextMessage?.();
      const contextContent = contextResult instanceof Promise ? await contextResult : contextResult;
      if (active !== token) return; // Re-check: stop()/a new send may have run during the await.
      const historyMessages = history.map(({ role, content }) => ({ role, content }));
      const messages = contextContent
        ? [{ role: 'system' as const, content: [{ type: 'text' as const, text: contextContent }] }, ...historyMessages]
        : historyMessages;
      token.handle = client.run({
        threadId: state.thread?.id,
        model,
        messages,
        tools: resolveToolManifest?.(),
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

  function start(history: readonly CopilotMessage[]): boolean {
    if (active || !enabled) return false;
    const token: ActiveRun = { sequence: 0, frontendToolControllers: new Map() };
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
      toolCalls: [],
    });
    void consume(token, history);
    return true;
  }

  const access: CopilotAccess = {
    client,
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
