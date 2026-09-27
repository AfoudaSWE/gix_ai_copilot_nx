import { sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { assertValidId } from '@gixcopilot/tenancy';
import type { UsageDimension, UsageRow, UsageStore } from '@gixcopilot/usage';
import { usageEvents } from './schema.js';

/** Whitelisted grouping expressions: dimensions never interpolate caller strings into SQL. */
const DIMENSIONS: Readonly<Record<UsageDimension, SQL>> = {
  kind: sql`${usageEvents.kind}`,
  model: sql`coalesce(${usageEvents.model}, '')`,
  provider: sql`coalesce(${usageEvents.provider}, '')`,
  project: sql`coalesce(${usageEvents.projectId}, '')`,
  environment: sql`coalesce(${usageEvents.environment}, '')`,
  agent: sql`coalesce(${usageEvents.agentId}, '')`,
  tool: sql`coalesce(${usageEvents.tool}, '')`,
  subject: sql`coalesce(${usageEvents.subject}, '')`,
  day: sql`to_char(${usageEvents.occurredAt} at time zone 'UTC', 'YYYY-MM-DD')`,
  month: sql`to_char(${usageEvents.occurredAt} at time zone 'UTC', 'YYYY-MM')`,
};

/** PostgreSQL `UsageStore`: idempotent inserts, SQL aggregation on tenant-leading indexes. */
export function createPostgresUsageStore(db: NodePgDatabase): UsageStore {
  return {
    async record(events) {
      if (events.length === 0) return;
      await db
        .insert(usageEvents)
        .values(
          events.map((event) => ({
            tenantId: event.tenantId,
            id: event.id,
            occurredAt: new Date(event.occurredAt),
            projectId: event.projectId ?? null,
            environment: event.environment ?? null,
            subject: event.subject ?? null,
            runId: event.runId ?? null,
            kind: event.kind,
            provider: event.provider ?? null,
            model: event.model ?? null,
            agentId: event.agentId ?? null,
            tool: event.tool ?? null,
            inputTokens: event.inputTokens,
            outputTokens: event.outputTokens,
            totalTokens: event.totalTokens,
            count: event.count,
            latencyMs: event.latencyMs ?? null,
            estimatedCostMicros: event.estimatedCostMicros ?? null,
          })),
        )
        .onConflictDoNothing();
    },
    forTenant(scope) {
      const tenantId = assertValidId(scope.tenantId, 'tenant id');
      return {
        async aggregate(query = {}) {
          const groupBy = [...new Set(query.groupBy ?? [])];
          const conditions: SQL[] = [sql`${usageEvents.tenantId} = ${tenantId}`];
          if (scope.projectId) conditions.push(sql`${usageEvents.projectId} = ${scope.projectId}`);
          if (scope.environment) conditions.push(sql`${usageEvents.environment} = ${scope.environment}`);
          if (query.from) conditions.push(sql`${usageEvents.occurredAt} >= ${new Date(query.from)}`);
          if (query.to) conditions.push(sql`${usageEvents.occurredAt} < ${new Date(query.to)}`);
          if (query.kinds?.length) conditions.push(sql`${usageEvents.kind} in (${sql.join(query.kinds.map((kind) => sql`${kind}`), sql`, `)})`);
          const keys = groupBy.map((dimension, index) => sql`${DIMENSIONS[dimension]} as ${sql.raw(`k${index}`)}`);
          const selection = sql.join(
            [
              ...keys,
              sql`sum(${usageEvents.count})::bigint as count`,
              sql`sum(${usageEvents.inputTokens})::bigint as input_tokens`,
              sql`sum(${usageEvents.outputTokens})::bigint as output_tokens`,
              sql`sum(${usageEvents.totalTokens})::bigint as total_tokens`,
              sql`coalesce(sum(${usageEvents.estimatedCostMicros}), 0)::bigint as cost`,
              sql`count(${usageEvents.estimatedCostMicros})::bigint as priced`,
              sql`count(*)::bigint as events`,
            ],
            sql`, `,
          );
          const grouping = groupBy.length > 0 ? sql` group by ${sql.join(groupBy.map((_, index) => sql.raw(String(index + 1))), sql`, `)}` : sql``;
          const result = await db.execute(sql`select ${selection} from ${usageEvents} where ${sql.join(conditions, sql` and `)}${grouping}`);
          return result.rows
            .filter((row) => Number(row['events']) > 0)
            .map(
              (row): UsageRow => ({
                key: Object.fromEntries(groupBy.map((dimension, index) => {
                  const value = row[`k${index}`];
                  return [dimension, typeof value === 'string' || typeof value === 'number' ? String(value) : ''];
                })),
                count: Number(row['count']),
                inputTokens: Number(row['input_tokens']),
                outputTokens: Number(row['output_tokens']),
                totalTokens: Number(row['total_tokens']),
                estimatedCostMicros: Number(row['cost']),
                pricedEvents: Number(row['priced']),
                events: Number(row['events']),
              }),
            );
        },
      };
    },
  };
}
