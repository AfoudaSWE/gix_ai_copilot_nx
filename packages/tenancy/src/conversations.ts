import type { ContentPart, MessageRole, Usage } from '@gixcopilot/protocol';
import type { RuntimeScope } from './scope.js';
import { assertValidId } from './scope.js';

export interface ThreadRecord {
  readonly id: string;
  readonly tenantId: string;
  readonly projectId?: string;
  readonly environment?: string;
  /** The authenticated subject that owns the thread. */
  readonly subject?: string;
  readonly title?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface StoredMessage {
  readonly id: string;
  readonly threadId: string;
  readonly role: MessageRole;
  readonly content: readonly ContentPart[];
  readonly runId?: string;
  readonly createdAt: string;
}

export type StoredRunStatus = 'running' | 'completed' | 'failed' | 'cancelled';

export interface StoredRun {
  readonly id: string;
  readonly threadId?: string;
  readonly tenantId: string;
  readonly projectId?: string;
  readonly environment?: string;
  readonly subject?: string;
  readonly status: StoredRunStatus;
  readonly model?: { readonly provider: string; readonly model: string };
  readonly usage?: Usage;
  readonly errorCode?: string;
  readonly startedAt: string;
  readonly endedAt?: string;
}

export interface Page<T> {
  readonly items: readonly T[];
  /** Opaque cursor for the next page, when there is one. */
  readonly nextCursor?: string;
}

export interface ListOptions {
  readonly limit?: number;
  readonly cursor?: string;
}

/**
 * Conversation storage for ONE tenant. Obtained only through `ConversationStore.forTenant`,
 * so no method takes a tenant id and no caller can forget the tenant filter (Section 46).
 */
export interface ScopedConversationStore {
  readonly scope: RuntimeScope;
  upsertThread(input: { readonly id: string; readonly subject?: string; readonly title?: string }): Promise<ThreadRecord>;
  getThread(id: string): Promise<ThreadRecord | null>;
  listThreads(options?: ListOptions & { readonly subject?: string }): Promise<Page<ThreadRecord>>;
  appendMessages(threadId: string, messages: readonly Omit<StoredMessage, 'threadId'>[]): Promise<void>;
  listMessages(threadId: string, options?: ListOptions): Promise<Page<StoredMessage>>;
  startRun(run: Omit<StoredRun, 'tenantId' | 'projectId' | 'environment' | 'status' | 'endedAt'>): Promise<void>;
  finishRun(id: string, outcome: { readonly status: Exclude<StoredRunStatus, 'running'>; readonly usage?: Usage; readonly errorCode?: string }): Promise<void>;
  getRun(id: string): Promise<StoredRun | null>;
  listRuns(options?: ListOptions & { readonly threadId?: string }): Promise<Page<StoredRun>>;
  /** Deletes a thread with its messages and runs (data-lifecycle requests). Audit is kept. */
  deleteThread(id: string): Promise<boolean>;
  /** Deletes every thread owned by a subject (user data deletion). Returns the count. */
  deleteSubjectData(subject: string): Promise<number>;
}

export interface ConversationStore {
  forTenant(scope: RuntimeScope): ScopedConversationStore;
}

export const MAX_PAGE_SIZE = 200;

export function pageSize(limit: number | undefined): number {
  if (limit === undefined) return 50;
  if (!Number.isInteger(limit) || limit < 1) return 1;
  return Math.min(limit, MAX_PAGE_SIZE);
}

/** In-memory `ConversationStore` for development and tests (not durable). */
export function createInMemoryConversationStore(now: () => Date = () => new Date()): ConversationStore {
  const threads = new Map<string, ThreadRecord>();
  const messages = new Map<string, StoredMessage[]>();
  const runs = new Map<string, StoredRun>();
  const key = (tenantId: string, id: string): string => `${tenantId}\u0000${id}`;

  function paginate<T>(items: readonly T[], options: ListOptions = {}): Page<T> {
    const start = options.cursor ? Number.parseInt(options.cursor, 10) || 0 : 0;
    const size = pageSize(options.limit);
    const slice = items.slice(start, start + size);
    return { items: slice, ...(start + size < items.length ? { nextCursor: String(start + size) } : {}) };
  }

  return {
    forTenant(scope) {
      const tenantId = assertValidId(scope.tenantId, 'tenant id');
      const inScope = (record: { tenantId: string; projectId?: string; environment?: string }): boolean =>
        record.tenantId === tenantId &&
        (scope.projectId === undefined || record.projectId === scope.projectId) &&
        (scope.environment === undefined || record.environment === scope.environment);
      const thread = (id: string): ThreadRecord | undefined => {
        const found = threads.get(key(tenantId, id));
        return found && inScope(found) ? found : undefined;
      };
      return {
        scope,
        upsertThread(input) {
          assertValidId(input.id, 'thread id');
          const existing = threads.get(key(tenantId, input.id));
          const timestamp = now().toISOString();
          const record: ThreadRecord = {
            id: input.id,
            tenantId,
            projectId: existing?.projectId ?? scope.projectId,
            environment: existing?.environment ?? scope.environment,
            subject: existing?.subject ?? input.subject,
            title: input.title ?? existing?.title,
            createdAt: existing?.createdAt ?? timestamp,
            updatedAt: timestamp,
          };
          threads.set(key(tenantId, input.id), record);
          return Promise.resolve(record);
        },
        getThread: (id) => Promise.resolve(thread(id) ?? null),
        listThreads(options = {}) {
          const items = [...threads.values()]
            .filter((record) => inScope(record) && (options.subject === undefined || record.subject === options.subject))
            .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
          return Promise.resolve(paginate(items, options));
        },
        appendMessages(threadId, batch) {
          if (!thread(threadId)) return Promise.reject(new Error(`Unknown thread ${threadId}`));
          const list = messages.get(key(tenantId, threadId)) ?? [];
          list.push(...batch.map((message) => ({ ...message, threadId })));
          messages.set(key(tenantId, threadId), list);
          return Promise.resolve();
        },
        listMessages(threadId, options) {
          if (!thread(threadId)) return Promise.resolve({ items: [] });
          return Promise.resolve(paginate(messages.get(key(tenantId, threadId)) ?? [], options));
        },
        startRun(run) {
          runs.set(key(tenantId, run.id), { ...run, tenantId, projectId: scope.projectId, environment: scope.environment, status: 'running' });
          return Promise.resolve();
        },
        finishRun(id, outcome) {
          const existing = runs.get(key(tenantId, id));
          if (existing && inScope(existing)) runs.set(key(tenantId, id), { ...existing, ...outcome, endedAt: now().toISOString() });
          return Promise.resolve();
        },
        getRun(id) {
          const run = runs.get(key(tenantId, id));
          return Promise.resolve(run && inScope(run) ? run : null);
        },
        listRuns(options = {}) {
          const items = [...runs.values()]
            .filter((run) => inScope(run) && (options.threadId === undefined || run.threadId === options.threadId))
            .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
          return Promise.resolve(paginate(items, options));
        },
        deleteThread(id) {
          if (!thread(id)) return Promise.resolve(false);
          threads.delete(key(tenantId, id));
          messages.delete(key(tenantId, id));
          for (const [runKey, run] of runs) if (run.tenantId === tenantId && run.threadId === id) runs.delete(runKey);
          return Promise.resolve(true);
        },
        async deleteSubjectData(subject) {
          let count = 0;
          for (const record of [...threads.values()]) {
            if (inScope(record) && record.subject === subject && (await this.deleteThread(record.id))) count += 1;
          }
          return count;
        },
      };
    },
  };
}
