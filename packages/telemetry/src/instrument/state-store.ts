import type { TelemetryAdapter } from '../adapter.js';
import type { Correlation } from '../conventions.js';
import { diagnostic } from '../diagnostics.js';
import type { StatePatchDiagnostic } from '../diagnostics.js';

/** Structural subset of `@gixcopilot/context`'s `CopilotStateStore` - duck-typed. */
export type StatePatchResultLike =
  | { readonly status: 'applied'; readonly revision: number; readonly value: unknown }
  | { readonly status: 'conflict'; readonly currentRevision: number }
  | { readonly status: 'rejected'; readonly reason: string; readonly detail?: string };

export interface CopilotStateStoreLike {
  set<T>(id: string, value: T): void;
  update<T>(id: string, updater: (previous: T) => T): void;
  getRevision(id: string): number | undefined;
  get<T>(id: string): T | undefined;
  applyPatch(id: string, patch: { readonly op: string; readonly value: unknown }, baseRevision: number): StatePatchResultLike;
}

export interface ObserveStateStoreOptions {
  readonly correlation?: Correlation | (() => Correlation | undefined);
}

/**
 * Observes a state store (Section 35-36, 69): every `set`/`update` (application origin) and
 * every `applyPatch` (model origin, including conflicts and rejections that the store's own
 * `subscribe` never reports) becomes a `state.patch` diagnostic with from/to revisions -
 * the raw material for a state timeline and safe time-travel reconstruction.
 */
export function observeStateStore<T extends CopilotStateStoreLike>(store: T, telemetry: TelemetryAdapter, options: ObserveStateStoreOptions = {}): T {
  if (!telemetry.enabled) return store;
  const correlation = (): Correlation | undefined => (typeof options.correlation === 'function' ? options.correlation() : options.correlation);
  const redaction = telemetry.redaction;

  function emit(body: Omit<StatePatchDiagnostic, 'id' | 'timestamp' | 'diagnosticVersion' | 'correlation' | 'type'>): void {
    telemetry.recordEvent(diagnostic<StatePatchDiagnostic>({ type: 'state.patch', correlation: correlation() ?? {}, ...body }));
  }

  const observed: CopilotStateStoreLike = {
    set(id, value) {
      const fromRevision = store.getRevision(id);
      try {
        store.set(id, value);
      } catch (error) {
        emit({ stateId: id, origin: 'application', op: 'set', fromRevision, outcome: 'rejected', reason: error instanceof Error ? error.message : String(error) });
        throw error;
      }
      emit({ stateId: id, origin: 'application', op: 'set', fromRevision, toRevision: store.getRevision(id), outcome: 'applied', value: redaction?.payload(value) });
    },
    update(id, updater) {
      const fromRevision = store.getRevision(id);
      try {
        store.update(id, updater);
      } catch (error) {
        emit({ stateId: id, origin: 'application', op: 'update', fromRevision, outcome: 'rejected', reason: error instanceof Error ? error.message : String(error) });
        throw error;
      }
      emit({ stateId: id, origin: 'application', op: 'update', fromRevision, toRevision: store.getRevision(id), outcome: 'applied', value: redaction?.payload(store.get(id)) });
    },
    getRevision: (id) => store.getRevision(id),
    get: <V>(id: string) => store.get<V>(id),
    applyPatch(id, patch, baseRevision) {
      const result = store.applyPatch(id, patch, baseRevision);
      if (result.status === 'applied') {
        emit({ stateId: id, origin: 'model', op: patch.op, fromRevision: baseRevision, toRevision: result.revision, outcome: 'applied', value: redaction?.payload(result.value) });
      } else if (result.status === 'conflict') {
        emit({ stateId: id, origin: 'model', op: patch.op, fromRevision: baseRevision, toRevision: result.currentRevision, outcome: 'conflict', reason: 'stale base revision' });
      } else {
        emit({ stateId: id, origin: 'model', op: patch.op, fromRevision: baseRevision, outcome: 'rejected', reason: result.detail ? `${result.reason}: ${result.detail}` : result.reason });
      }
      return result;
    },
  };
  return Object.assign(Object.create(Object.getPrototypeOf(store) as object) as T, store, observed);
}
