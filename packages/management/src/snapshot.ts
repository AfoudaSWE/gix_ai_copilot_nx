import type { RuntimeScope } from '@gixcopilot/tenancy';
import type { ConfigSnapshot } from './service.js';

export interface SnapshotResult {
  readonly snapshot: ConfigSnapshot;
  /** True when the control plane could not be reached and the last good snapshot is served. */
  readonly stale: boolean;
}

/**
 * Data-plane access to control-plane configuration (Section 169-172). Snapshots are cached
 * for `ttlMs` (invalidation: time-based, plus `invalidate()` after an admin edit event). If
 * loading fails, the last good snapshot keeps serving traffic (the platform being down must
 * not take the runtime down); with no snapshot at all, the error propagates.
 */
export function createSnapshotCache(options: { readonly load: (scope: RuntimeScope) => Promise<ConfigSnapshot>; readonly ttlMs?: number; readonly now?: () => number }) {
  const ttlMs = options.ttlMs ?? 30_000;
  const now = options.now ?? Date.now;
  const cache = new Map<string, { snapshot: ConfigSnapshot; loadedAt: number }>();
  const key = (scope: RuntimeScope): string => `${scope.tenantId}|${scope.projectId ?? ''}|${scope.environment ?? ''}`;
  return {
    async get(scope: RuntimeScope): Promise<SnapshotResult> {
      const cached = cache.get(key(scope));
      if (cached && now() - cached.loadedAt < ttlMs) return { snapshot: cached.snapshot, stale: false };
      try {
        const snapshot = await options.load(scope);
        cache.set(key(scope), { snapshot, loadedAt: now() });
        return { snapshot, stale: false };
      } catch (error) {
        if (cached) return { snapshot: cached.snapshot, stale: true };
        throw error;
      }
    },
    invalidate(scope?: RuntimeScope): void {
      if (scope) cache.delete(key(scope));
      else cache.clear();
    },
  };
}
