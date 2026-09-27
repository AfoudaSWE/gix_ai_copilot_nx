import type { RuntimeScope } from '@gixcopilot/tenancy';

/**
 * One usage fact. Usage is *accounting*, not billing (Section 70): a billing system may
 * consume these later; `estimatedCostMicros` is an estimate from configured pricing.
 */
export type UsageKind = 'request' | 'model' | 'tool' | 'agent_run' | 'workflow_run' | 'rag_query' | 'embedding';

export interface UsageEvent {
  /** Stable id for idempotent recording (e.g. `${runId}:model`). */
  readonly id: string;
  readonly tenantId: string;
  readonly projectId?: string;
  readonly environment?: string;
  readonly subject?: string;
  readonly runId?: string;
  readonly kind: UsageKind;
  readonly provider?: string;
  readonly model?: string;
  readonly agentId?: string;
  readonly tool?: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
  readonly count: number;
  readonly latencyMs?: number;
  /** Estimated cost in millionths of the pricing currency; absent when no price is configured. */
  readonly estimatedCostMicros?: number;
  readonly occurredAt: string;
}

export type UsageDimension = 'kind' | 'model' | 'provider' | 'project' | 'environment' | 'agent' | 'tool' | 'subject' | 'day' | 'month';

export interface UsageQuery {
  readonly from?: string;
  readonly to?: string;
  readonly kinds?: readonly UsageKind[];
  readonly groupBy?: readonly UsageDimension[];
}

export interface UsageRow {
  readonly key: Readonly<Partial<Record<UsageDimension, string>>>;
  readonly count: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
  /** Sum of the estimates that exist; `pricedEvents` says how many rows had a price. */
  readonly estimatedCostMicros: number;
  readonly pricedEvents: number;
  readonly events: number;
}

export interface ScopedUsageStore {
  aggregate(query?: UsageQuery): Promise<readonly UsageRow[]>;
}

/** Usage storage. Writes carry their tenant; reads only through `forTenant`. */
export interface UsageStore {
  record(events: readonly UsageEvent[]): Promise<void>;
  forTenant(scope: RuntimeScope): ScopedUsageStore;
}

export function periodStart(period: 'day' | 'month', now: Date): Date {
  return period === 'day'
    ? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
    : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export function dimensionValue(event: UsageEvent, dimension: UsageDimension): string {
  switch (dimension) {
    case 'kind':
      return event.kind;
    case 'model':
      return event.model ?? '';
    case 'provider':
      return event.provider ?? '';
    case 'project':
      return event.projectId ?? '';
    case 'environment':
      return event.environment ?? '';
    case 'agent':
      return event.agentId ?? '';
    case 'tool':
      return event.tool ?? '';
    case 'subject':
      return event.subject ?? '';
    case 'day':
      return event.occurredAt.slice(0, 10);
    case 'month':
      return event.occurredAt.slice(0, 7);
  }
}

/** In-memory `UsageStore` for development and tests (not durable). */
export function createInMemoryUsageStore(): UsageStore & { all(): readonly UsageEvent[] } {
  const events = new Map<string, UsageEvent>();
  return {
    record(batch) {
      for (const event of batch) {
        const key = `${event.tenantId}\u0000${event.id}`;
        if (!events.has(key)) events.set(key, event);
      }
      return Promise.resolve();
    },
    all: () => [...events.values()],
    forTenant(scope) {
      return {
        aggregate(query = {}) {
          const rows = new Map<string, { key: Partial<Record<UsageDimension, string>> } & Omit<UsageRow, 'key'>>();
          for (const event of events.values()) {
            if (event.tenantId !== scope.tenantId) continue;
            if (scope.projectId && event.projectId !== scope.projectId) continue;
            if (scope.environment && event.environment !== scope.environment) continue;
            if (query.from && event.occurredAt < query.from) continue;
            if (query.to && event.occurredAt >= query.to) continue;
            if (query.kinds && !query.kinds.includes(event.kind)) continue;
            const key: Partial<Record<UsageDimension, string>> = {};
            for (const dimension of query.groupBy ?? []) key[dimension] = dimensionValue(event, dimension);
            const id = JSON.stringify(key);
            const row = rows.get(id) ?? { key, count: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, estimatedCostMicros: 0, pricedEvents: 0, events: 0 };
            rows.set(id, {
              key,
              count: row.count + event.count,
              inputTokens: row.inputTokens + event.inputTokens,
              outputTokens: row.outputTokens + event.outputTokens,
              totalTokens: row.totalTokens + event.totalTokens,
              estimatedCostMicros: row.estimatedCostMicros + (event.estimatedCostMicros ?? 0),
              pricedEvents: row.pricedEvents + (event.estimatedCostMicros === undefined ? 0 : 1),
              events: row.events + 1,
            });
          }
          return Promise.resolve([...rows.values()]);
        },
      };
    },
  };
}
