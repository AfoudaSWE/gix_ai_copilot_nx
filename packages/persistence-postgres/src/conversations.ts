import { and, desc, eq, gt, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { ContentPart, MessageRole, Usage } from '@gixcopilot/protocol';
import { assertValidId, pageSize } from '@gixcopilot/tenancy';
import type { ConversationStore, Page, RuntimeScope, ScopedConversationStore, StoredMessage, StoredRun, ThreadRecord } from '@gixcopilot/tenancy';
import { messages, runs, threads } from './schema.js';

type ThreadRow = typeof threads.$inferSelect;
type RunRow = typeof runs.$inferSelect;

const iso = (value: Date | null): string | undefined => value?.toISOString();

function toThread(row: ThreadRow): ThreadRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    ...(row.projectId ? { projectId: row.projectId } : {}),
    ...(row.environment ? { environment: row.environment } : {}),
    ...(row.subject ? { subject: row.subject } : {}),
    ...(row.title ? { title: row.title } : {}),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toRun(row: RunRow): StoredRun {
  return {
    id: row.id,
    tenantId: row.tenantId,
    status: row.status as StoredRun['status'],
    startedAt: row.startedAt.toISOString(),
    ...(row.threadId ? { threadId: row.threadId } : {}),
    ...(row.projectId ? { projectId: row.projectId } : {}),
    ...(row.environment ? { environment: row.environment } : {}),
    ...(row.subject ? { subject: row.subject } : {}),
    ...(row.modelProvider && row.modelName ? { model: { provider: row.modelProvider, model: row.modelName } } : {}),
    ...(row.usage ? { usage: row.usage as Usage } : {}),
    ...(row.errorCode ? { errorCode: row.errorCode } : {}),
    ...(row.endedAt ? { endedAt: iso(row.endedAt) } : {}),
  };
}

/** Keyset cursor: `<iso timestamp>|<id>` of the last item of the previous page. */
function decodeCursor(cursor: string | undefined): { at: Date; id: string } | undefined {
  if (!cursor) return undefined;
  const [at, id] = cursor.split('|');
  const date = at ? new Date(at) : undefined;
  return date && !Number.isNaN(date.getTime()) && id ? { at: date, id } : undefined;
}

/**
 * PostgreSQL `ConversationStore`. The only way to reach data is `forTenant(scope)`, and every
 * statement below includes `tenant_id = scope.tenantId` (plus project/environment narrowing
 * when the scope has them). Pagination is keyset-based on indexed columns.
 */
export function createPostgresConversationStore(db: NodePgDatabase): ConversationStore {
  return {
    forTenant(scope: RuntimeScope): ScopedConversationStore {
      const tenantId = assertValidId(scope.tenantId, 'tenant id');
      const threadScope = (): SQL[] => [
        eq(threads.tenantId, tenantId),
        ...(scope.projectId ? [eq(threads.projectId, scope.projectId)] : []),
        ...(scope.environment ? [eq(threads.environment, scope.environment)] : []),
      ];
      const runScope = (): SQL[] => [
        eq(runs.tenantId, tenantId),
        ...(scope.projectId ? [eq(runs.projectId, scope.projectId)] : []),
        ...(scope.environment ? [eq(runs.environment, scope.environment)] : []),
      ];
      const findThread = async (id: string): Promise<ThreadRow | undefined> =>
        (await db.select().from(threads).where(and(...threadScope(), eq(threads.id, id))).limit(1))[0];

      const store: ScopedConversationStore = {
        scope,
        async upsertThread(input) {
          assertValidId(input.id, 'thread id');
          const now = new Date();
          const [row] = await db
            .insert(threads)
            .values({ tenantId, id: input.id, projectId: scope.projectId, environment: scope.environment, subject: input.subject, title: input.title, createdAt: now, updatedAt: now })
            .onConflictDoUpdate({
              target: [threads.tenantId, threads.id],
              set: { updatedAt: now, ...(input.title ? { title: input.title } : {}) },
            })
            .returning();
          if (!row) throw new Error('thread upsert returned no row');
          return toThread(row);
        },
        async getThread(id) {
          const row = await findThread(id);
          return row ? toThread(row) : null;
        },
        async listThreads(options = {}) {
          const size = pageSize(options.limit);
          const cursor = decodeCursor(options.cursor);
          const rows = await db
            .select()
            .from(threads)
            .where(
              and(
                ...threadScope(),
                ...(options.subject ? [eq(threads.subject, options.subject)] : []),
                ...(cursor ? [sql`(${threads.updatedAt}, ${threads.id}) < (${cursor.at}, ${cursor.id})`] : []),
              ),
            )
            .orderBy(desc(threads.updatedAt), desc(threads.id))
            .limit(size + 1);
          const items = rows.slice(0, size).map(toThread);
          const last = items.at(-1);
          return { items, ...(rows.length > size && last ? { nextCursor: `${last.updatedAt}|${last.id}` } : {}) };
        },
        async appendMessages(threadId, batch) {
          if (!(await findThread(threadId))) throw new Error(`Unknown thread ${threadId}`);
          if (batch.length === 0) return;
          await db
            .insert(messages)
            .values(batch.map((message) => ({ tenantId, threadId, id: message.id, role: message.role, content: message.content, runId: message.runId, createdAt: new Date(message.createdAt) })))
            .onConflictDoNothing();
          await db.update(threads).set({ updatedAt: new Date() }).where(and(eq(threads.tenantId, tenantId), eq(threads.id, threadId)));
        },
        async listMessages(threadId, options = {}): Promise<Page<StoredMessage>> {
          if (!(await findThread(threadId))) return { items: [] };
          const size = pageSize(options.limit);
          const after = options.cursor ? Number.parseInt(options.cursor, 10) : undefined;
          const rows = await db
            .select()
            .from(messages)
            .where(and(eq(messages.tenantId, tenantId), eq(messages.threadId, threadId), ...(after !== undefined && Number.isFinite(after) ? [gt(messages.seq, after)] : [])))
            .orderBy(messages.seq)
            .limit(size + 1);
          const page = rows.slice(0, size);
          const last = page.at(-1);
          return {
            items: page.map((row) => ({ id: row.id, threadId: row.threadId, role: row.role as MessageRole, content: row.content as ContentPart[], createdAt: row.createdAt.toISOString(), ...(row.runId ? { runId: row.runId } : {}) })),
            ...(rows.length > size && last ? { nextCursor: String(last.seq) } : {}),
          };
        },
        async startRun(run) {
          await db
            .insert(runs)
            .values({
              tenantId,
              id: run.id,
              threadId: run.threadId,
              projectId: scope.projectId,
              environment: scope.environment,
              subject: run.subject,
              status: 'running',
              modelProvider: run.model?.provider,
              modelName: run.model?.model,
              startedAt: new Date(run.startedAt),
            })
            .onConflictDoNothing();
        },
        async finishRun(id, outcome) {
          await db
            .update(runs)
            .set({ status: outcome.status, usage: outcome.usage ?? null, errorCode: outcome.errorCode ?? null, endedAt: new Date() })
            .where(and(...runScope(), eq(runs.id, id)));
        },
        async getRun(id) {
          const [row] = await db.select().from(runs).where(and(...runScope(), eq(runs.id, id))).limit(1);
          return row ? toRun(row) : null;
        },
        async listRuns(options = {}) {
          const size = pageSize(options.limit);
          const cursor = decodeCursor(options.cursor);
          const rows = await db
            .select()
            .from(runs)
            .where(
              and(
                ...runScope(),
                ...(options.threadId ? [eq(runs.threadId, options.threadId)] : []),
                ...(cursor ? [sql`(${runs.startedAt}, ${runs.id}) < (${cursor.at}, ${cursor.id})`] : []),
              ),
            )
            .orderBy(desc(runs.startedAt), desc(runs.id))
            .limit(size + 1);
          const items = rows.slice(0, size).map(toRun);
          const last = items.at(-1);
          return { items, ...(rows.length > size && last ? { nextCursor: `${last.startedAt}|${last.id}` } : {}) };
        },
        async deleteThread(id) {
          const row = await findThread(id);
          if (!row) return false;
          await db.transaction(async (tx) => {
            await tx.delete(runs).where(and(eq(runs.tenantId, tenantId), eq(runs.threadId, id)));
            await tx.delete(threads).where(and(eq(threads.tenantId, tenantId), eq(threads.id, id)));
          });
          return true;
        },
        async deleteSubjectData(subject) {
          const owned = await db.select({ id: threads.id }).from(threads).where(and(...threadScope(), eq(threads.subject, subject)));
          let count = 0;
          for (const { id } of owned) if (await store.deleteThread(id)) count += 1;
          return count;
        },
      };
      return store;
    },
  };
}
