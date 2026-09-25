import type { Usage } from '@gixcopilot/protocol';

export const ZERO_USAGE: Usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };

export function addUsage(a: Usage, b: Usage | undefined): Usage {
  if (!b) return a;
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    totalTokens: a.totalTokens + b.totalTokens,
  };
}

export function sumUsage(usages: readonly (Usage | undefined)[]): Usage {
  return usages.reduce<Usage>((total, usage) => addUsage(total, usage), ZERO_USAGE);
}

export interface RunUsageEntry {
  readonly runId: string;
  readonly parentRunId?: string;
  readonly usage: Usage | undefined;
}

export interface RunTreeUsage {
  /** This run's own model calls only. */
  readonly own: Usage;
  /** This run plus every descendant, each model call counted exactly once (Section 214). */
  readonly total: Usage;
  readonly children: readonly string[];
}

/**
 * Aggregates model-call usage across a delegation tree without double counting: every entry
 * is one model call attributed to exactly one run; a run's `total` sums its own calls and its
 * descendants' totals, so a parent never re-counts what a child already reported.
 */
export function aggregateRunTreeUsage(entries: readonly RunUsageEntry[]): Readonly<Record<string, RunTreeUsage>> {
  const own = new Map<string, Usage>();
  const children = new Map<string, Set<string>>();
  for (const entry of entries) {
    own.set(entry.runId, addUsage(own.get(entry.runId) ?? ZERO_USAGE, entry.usage));
    if (!children.has(entry.runId)) children.set(entry.runId, new Set());
    if (entry.parentRunId) {
      if (!children.has(entry.parentRunId)) children.set(entry.parentRunId, new Set());
      children.get(entry.parentRunId)?.add(entry.runId);
      if (!own.has(entry.parentRunId)) own.set(entry.parentRunId, ZERO_USAGE);
    }
  }
  const totals = new Map<string, Usage>();
  const visiting = new Set<string>();
  function total(runId: string): Usage {
    const cached = totals.get(runId);
    if (cached) return cached;
    if (visiting.has(runId)) return own.get(runId) ?? ZERO_USAGE;
    visiting.add(runId);
    let sum = own.get(runId) ?? ZERO_USAGE;
    for (const child of children.get(runId) ?? []) sum = addUsage(sum, total(child));
    visiting.delete(runId);
    totals.set(runId, sum);
    return sum;
  }
  const result: Record<string, RunTreeUsage> = {};
  for (const runId of own.keys()) {
    result[runId] = { own: own.get(runId) ?? ZERO_USAGE, total: total(runId), children: [...(children.get(runId) ?? [])] };
  }
  return result;
}
