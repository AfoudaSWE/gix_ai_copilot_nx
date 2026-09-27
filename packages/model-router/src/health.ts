import type { ModelReference } from '@gixcopilot/provider';

export type HealthOutcome = 'success' | 'failure' | 'timeout' | 'rate_limited';

export interface HealthSnapshot {
  readonly model: string;
  readonly available: boolean;
  readonly samples: number;
  readonly failures: number;
  readonly openUntil?: string;
}

/**
 * Per-model health from recent outcomes (Section 64). A model is marked unavailable only when
 * the recent window has at least `minSamples` calls AND the failure ratio reaches
 * `failureRatio` - one failure never takes a model out, and a failing model never marks its
 * whole provider down. After `cooldownMs` it becomes available again (half-open: the next
 * call decides).
 */
export interface ProviderHealth {
  record(model: ModelReference, outcome: HealthOutcome): void;
  isAvailable(model: ModelReference): boolean;
  snapshot(): readonly HealthSnapshot[];
}

export interface CreateProviderHealthOptions {
  readonly windowMs?: number;
  readonly minSamples?: number;
  readonly failureRatio?: number;
  readonly cooldownMs?: number;
  readonly now?: () => number;
}

export function createProviderHealth(options: CreateProviderHealthOptions = {}): ProviderHealth {
  const windowMs = options.windowMs ?? 60_000;
  const minSamples = options.minSamples ?? 5;
  const failureRatio = options.failureRatio ?? 0.5;
  const cooldownMs = options.cooldownMs ?? 30_000;
  const now = options.now ?? Date.now;
  const outcomes = new Map<string, { at: number; failed: boolean }[]>();
  const openUntil = new Map<string, number>();
  const key = (model: ModelReference): string => `${model.provider}/${model.model}`;

  const recent = (id: string): { at: number; failed: boolean }[] => {
    const cutoff = now() - windowMs;
    const list = (outcomes.get(id) ?? []).filter((entry) => entry.at >= cutoff);
    outcomes.set(id, list);
    return list;
  };

  return {
    record(model, outcome) {
      const id = key(model);
      const list = recent(id);
      list.push({ at: now(), failed: outcome !== 'success' });
      if (outcome === 'success') {
        openUntil.delete(id);
        return;
      }
      const failures = list.filter((entry) => entry.failed).length;
      if (list.length >= minSamples && failures / list.length >= failureRatio) openUntil.set(id, now() + cooldownMs);
    },
    isAvailable(model) {
      const until = openUntil.get(key(model));
      return until === undefined || now() >= until;
    },
    snapshot() {
      return [...outcomes.keys()].map((id) => {
        const list = recent(id);
        const until = openUntil.get(id);
        return {
          model: id,
          available: until === undefined || now() >= until,
          samples: list.length,
          failures: list.filter((entry) => entry.failed).length,
          ...(until !== undefined && now() < until ? { openUntil: new Date(until).toISOString() } : {}),
        };
      });
    },
  };
}
