import type { CopilotEvent, Usage } from '@gixcopilot/protocol';
import type { SecurityContext } from '@gixcopilot/security';
import { scopeFromSecurityContext } from '@gixcopilot/tenancy';
import type { RuntimeScope } from '@gixcopilot/tenancy';
import type { UsageEvent, UsageStore } from './model.js';
import { estimateCostMicros } from './pricing.js';
import type { PricingTable } from './pricing.js';

interface ObservedRun {
  readonly runId: string;
  readonly securityContext: SecurityContext;
  readonly model?: { readonly provider: string; readonly model: string };
  readonly startedAt: string;
}

interface RunTally {
  tools: Map<string, number>;
  agents: Map<string, number>;
  workflows: number;
}

export interface UsageRecorderOptions {
  readonly store: UsageStore;
  readonly pricing?: PricingTable;
  readonly now?: () => Date;
  /** Called when recording fails; recording never fails a user's run. */
  readonly onError?: (error: unknown) => void;
}

/**
 * Token and runtime accounting as a server run observer (Section 69): per run it records one
 * `request`, one `model` event with the run's tokens (and estimated cost when priced), and
 * counts of tool calls, agent runs and workflow runs, all under the authenticated tenant,
 * project and environment. Event ids derive from the run id, so replays are idempotent.
 * Runs without a tenant are not recorded.
 */
export function createUsageRecorder(options: UsageRecorderOptions) {
  const now = options.now ?? (() => new Date());
  const tallies = new Map<string, RunTally>();
  const tally = (runId: string): RunTally => {
    let entry = tallies.get(runId);
    if (!entry) {
      entry = { tools: new Map(), agents: new Map(), workflows: 0 };
      tallies.set(runId, entry);
    }
    return entry;
  };

  return {
    onEvent(event: CopilotEvent, info: ObservedRun): void {
      if (event.type === 'tool.completed' || event.type === 'tool.failed') {
        const entry = tally(info.runId);
        entry.tools.set(event.name, (entry.tools.get(event.name) ?? 0) + 1);
      } else if (event.type === 'agent.run.started') {
        const entry = tally(info.runId);
        entry.agents.set(event.agentId, (entry.agents.get(event.agentId) ?? 0) + 1);
      } else if (event.type === 'workflow.run.started') {
        tally(info.runId).workflows += 1;
      }
    },
    async onRunEnded(info: ObservedRun, outcome: { readonly status: string; readonly usage?: Usage }): Promise<void> {
      const entry = tallies.get(info.runId);
      tallies.delete(info.runId);
      const scope = scopeFromSecurityContext(info.securityContext);
      if (!scope) return;
      const events = usageEventsForRun(scope, info, outcome.usage, entry, options.pricing, now());
      try {
        await options.store.record(events);
      } catch (error) {
        options.onError?.(error);
      }
    },
  };
}

function usageEventsForRun(scope: RuntimeScope, info: ObservedRun, usage: Usage | undefined, entry: RunTally | undefined, pricing: PricingTable | undefined, at: Date): UsageEvent[] {
  const base = {
    tenantId: scope.tenantId,
    ...(scope.projectId ? { projectId: scope.projectId } : {}),
    ...(scope.environment ? { environment: scope.environment } : {}),
    ...(info.securityContext.identity?.subject ? { subject: info.securityContext.identity.subject } : {}),
    runId: info.runId,
    occurredAt: at.toISOString(),
  };
  const zero = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  const events: UsageEvent[] = [{ ...base, ...zero, id: `${info.runId}:request`, kind: 'request', count: 1, latencyMs: at.getTime() - Date.parse(info.startedAt) }];
  if (usage) {
    const cost = estimateCostMicros(pricing, { ...info.model, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens });
    events.push({
      ...base,
      id: `${info.runId}:model`,
      kind: 'model',
      count: 1,
      ...(info.model ? { provider: info.model.provider, model: info.model.model } : {}),
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      totalTokens: usage.totalTokens,
      ...(cost !== undefined ? { estimatedCostMicros: cost } : {}),
    });
  }
  for (const [tool, count] of entry?.tools ?? []) {
    const cost = estimateCostMicros(pricing, { tool, count, ...zero });
    events.push({ ...base, ...zero, id: `${info.runId}:tool:${tool}`, kind: 'tool', tool, count, ...(cost !== undefined ? { estimatedCostMicros: cost } : {}) });
  }
  for (const [agentId, count] of entry?.agents ?? []) events.push({ ...base, ...zero, id: `${info.runId}:agent:${agentId}`, kind: 'agent_run', agentId, count });
  if (entry && entry.workflows > 0) events.push({ ...base, ...zero, id: `${info.runId}:workflow`, kind: 'workflow_run', count: entry.workflows });
  return events;
}

/**
 * For usage that happens outside a chat run (RAG queries from a job, embeddings during
 * ingestion): record it directly, with an idempotency id you choose.
 */
export function createUsageMeter(options: { readonly store: UsageStore; readonly pricing?: PricingTable; readonly now?: () => Date }) {
  const now = options.now ?? (() => new Date());
  return {
    async record(scope: RuntimeScope, event: Omit<UsageEvent, 'tenantId' | 'projectId' | 'environment' | 'occurredAt' | 'estimatedCostMicros'> & { readonly occurredAt?: string }): Promise<void> {
      const cost = estimateCostMicros(options.pricing, event);
      await options.store.record([
        {
          ...event,
          tenantId: scope.tenantId,
          ...(scope.projectId ? { projectId: scope.projectId } : {}),
          ...(scope.environment ? { environment: scope.environment } : {}),
          occurredAt: event.occurredAt ?? now().toISOString(),
          ...(cost !== undefined ? { estimatedCostMicros: cost } : {}),
        },
      ]);
    },
  };
}
