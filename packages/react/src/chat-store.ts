import type { ClientModelReference, ClientRun, CopilotClient } from '@gixcopilot/client';
import { CopilotError, createMessageId, createThreadId } from '@gixcopilot/protocol';
import type { CopilotEvent, PublicCopilotError } from '@gixcopilot/protocol';
import type { ChatSnapshot, CopilotAccess, CopilotMessage } from './types.js';

interface ActiveRun {
  handle?: ClientRun;
  runId?: string;
  sequence: number;
}

interface ChatStore {
  readonly access: CopilotAccess;
  readonly getSnapshot: () => ChatSnapshot;
  readonly getServerSnapshot: () => ChatSnapshot;
  readonly subscribe: (listener: () => void) => () => void;
  readonly mount: () => void;
  readonly dispose: () => void;
}

/** Internal presentation store. Transport and runtime behavior stay in the client. */
export function createChatStore(
  client: CopilotClient,
  model?: ClientModelReference,
  threadId?: string,
): ChatStore {
  const initial: ChatSnapshot = {
    messages: [],
    thread: null,
    runId: null,
    status: 'idle',
    error: null,
    usage: undefined,
    finishReason: undefined,
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
                      text: message.content.map((part) => part.text).join('') + event.delta,
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
    }
  }

  async function consume(token: ActiveRun, history: readonly CopilotMessage[]): Promise<void> {
    try {
      if (active !== token || !enabled) return;
      token.handle = client.run({
        threadId: state.thread?.id,
        model,
        messages: history.map(({ role, content }) => ({ role, content })),
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
    }
  }

  function start(history: readonly CopilotMessage[]): boolean {
    if (active || !enabled) return false;
    const token: ActiveRun = { sequence: 0 };
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
