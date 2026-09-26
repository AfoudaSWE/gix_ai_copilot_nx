import type { DiagnosticEvent, TelemetryMode } from '@gixcopilot/telemetry';
import { exportBundle } from './bundle.js';
import type { ExportBundleOptions } from './bundle.js';
import { findRun } from './inspectors.js';
import { projectSession } from './session.js';
import type { DebugBundle, DevToolsSession, DevToolsViewer, DiagnosticsSnapshot, RunRecord } from './types.js';

/** Structural subset of `@gixcopilot/telemetry`'s `RecordingTelemetry` - the only thing
 * DevTools reads from. */
export interface DiagnosticsSource {
  session(): { readonly startedAt: string; readonly mode: TelemetryMode; readonly events: readonly DiagnosticEvent[]; readonly spans: DiagnosticsSnapshot['spans']; readonly dropped: number };
  subscribe(listener: (event: DiagnosticEvent) => void): () => void;
  clear?(): void;
}

export interface DevToolsRecorder {
  /** The raw, unscoped snapshot - for trusted in-process use only. */
  snapshot(): DiagnosticsSnapshot;
  getSession(viewer?: DevToolsViewer): DevToolsSession;
  getRun(runId: string, viewer?: DevToolsViewer): RunRecord | undefined;
  /** Live diagnostics for one viewer; events the viewer may not see are never delivered. */
  subscribe(listener: (event: DiagnosticEvent) => void, viewer?: DevToolsViewer): () => void;
  exportBundle(options?: ExportBundleOptions & { readonly viewer?: DevToolsViewer }): DebugBundle;
  clear(): void;
}

/**
 * DevTools observes the runtime; it never becomes it (Phase 11 Section 7). The recorder only
 * reads a diagnostics source the host already created and passed to the runtime as its
 * telemetry adapter - there is no DevTools-specific instrumentation path, and removing
 * DevTools changes nothing about how the runtime executes (Section 179).
 */
export function createDevTools(options: { readonly source: DiagnosticsSource }): DevToolsRecorder {
  const { source } = options;
  const snapshot = (): DiagnosticsSnapshot => {
    const session = source.session();
    return { startedAt: session.startedAt, mode: session.mode, events: session.events, spans: session.spans, dropped: session.dropped };
  };

  return {
    snapshot,
    getSession: (viewer) => projectSession(snapshot(), viewer),
    getRun: (runId, viewer) => findRun(projectSession(snapshot(), viewer), runId),
    subscribe(listener, viewer) {
      if (!viewer || (viewer.tenantId === undefined && viewer.subject === undefined)) return source.subscribe(listener);
      return source.subscribe((event) => {
        // Re-project a one-event snapshot plus history so child events of the viewer's runs
        // are delivered and everything else is withheld.
        const current = snapshot();
        const scoped = projectSession({ ...current, events: [...current.events.filter((existing) => existing.id !== event.id), event] }, viewer);
        if (scoped.events.some((visible) => visible.id === event.id)) listener(event);
      });
    },
    exportBundle(exportOptions = {}) {
      const scoped = exportOptions.viewer ? projectSession(snapshot(), exportOptions.viewer) : undefined;
      const base = snapshot();
      return exportBundle(scoped ? { ...base, events: scoped.events, spans: scoped.spans } : base, exportOptions);
    },
    clear() {
      source.clear?.();
    },
  };
}
