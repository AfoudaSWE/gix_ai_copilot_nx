import type { CopilotEvent, ContentPart } from '@gixcopilot/protocol';
import type { ConversationStore } from './conversations.js';
import { scopeFromSecurityContext } from './scope.js';

/** Shape-compatible with `@gixcopilot/server`'s `RunInfo`/`RunObserver` (no server dependency). */
interface ObservedRun {
  readonly runId: string;
  readonly threadId?: string;
  readonly securityContext: Parameters<typeof scopeFromSecurityContext>[0];
  readonly model?: { readonly provider: string; readonly model: string };
  readonly messages: readonly { readonly role: 'system' | 'user' | 'assistant' | 'tool'; readonly content: readonly ContentPart[] }[];
  readonly startedAt: string;
}

export interface ConversationRecorderOptions {
  /**
   * `metadata` stores threads and runs only; `content` also stores message text. Choose per
   * privacy policy (Section 94). Default `content`.
   */
  readonly retain?: 'metadata' | 'content';
}

/**
 * A server run observer that persists threads, the newest user turn, the assistant answer and
 * run metadata into a tenant-scoped `ConversationStore`. Runs without an authenticated tenant
 * are not persisted (nothing to scope them to).
 */
export function createConversationRecorder(store: ConversationStore, options: ConversationRecorderOptions = {}) {
  const retainContent = (options.retain ?? 'content') === 'content';
  const answers = new Map<string, { messageId?: string; text: string }>();
  let sequence = 0;
  return {
    async onRunStarted(info: ObservedRun): Promise<void> {
      const scope = scopeFromSecurityContext(info.securityContext);
      if (!scope || !info.threadId) return;
      const scoped = store.forTenant(scope);
      const subject = info.securityContext.identity?.subject;
      await scoped.upsertThread({ id: info.threadId, subject });
      await scoped.startRun({ id: info.runId, threadId: info.threadId, subject, model: info.model, startedAt: info.startedAt });
      const lastUser = [...info.messages].reverse().find((message) => message.role === 'user');
      if (retainContent && lastUser) {
        await scoped.appendMessages(info.threadId, [
          { id: `${info.runId}:user:${++sequence}`, role: 'user', content: lastUser.content, runId: info.runId, createdAt: info.startedAt },
        ]);
      }
    },
    onEvent(event: CopilotEvent, info: ObservedRun): void {
      if (event.type === 'message.started') answers.set(info.runId, { messageId: event.messageId, text: '' });
      else if (event.type === 'message.delta') {
        const answer = answers.get(info.runId) ?? { text: '' };
        answer.text += event.delta;
        answers.set(info.runId, answer);
      }
    },
    async onRunEnded(info: ObservedRun, outcome: { readonly status: 'completed' | 'failed' | 'cancelled'; readonly usage?: { inputTokens: number; outputTokens: number; totalTokens: number } }): Promise<void> {
      const answer = answers.get(info.runId);
      answers.delete(info.runId);
      const scope = scopeFromSecurityContext(info.securityContext);
      if (!scope || !info.threadId) return;
      const scoped = store.forTenant(scope);
      if (retainContent && answer && answer.text.length > 0) {
        await scoped.appendMessages(info.threadId, [
          { id: answer.messageId ?? `${info.runId}:assistant`, role: 'assistant', content: [{ type: 'text', text: answer.text }], runId: info.runId, createdAt: new Date().toISOString() },
        ]);
      }
      await scoped.finishRun(info.runId, { status: outcome.status, usage: outcome.usage });
    },
  };
}
