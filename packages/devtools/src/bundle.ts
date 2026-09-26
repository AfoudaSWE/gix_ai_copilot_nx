import { DIAGNOSTIC_VERSION, createRedactionPolicy } from '@gixcopilot/telemetry';
import type { DiagnosticEvent, RedactionPolicy, SpanDiagnostic, TelemetryMode } from '@gixcopilot/telemetry';
import type { DebugBundle, DiagnosticsSnapshot } from './types.js';

const PERMISSIVENESS: Record<TelemetryMode, number> = { off: 0, 'metadata-only': 1, redacted: 2, 'development-verbose': 3 };

/** The stricter of two modes - an export can only ever tighten what was recorded. */
export function stricterMode(a: TelemetryMode, b: TelemetryMode): TelemetryMode {
  return PERMISSIVENESS[a] <= PERMISSIVENESS[b] ? a : b;
}

function sanitizePayload(value: unknown, mode: TelemetryMode, policy: RedactionPolicy): unknown {
  if (value === undefined) return undefined;
  if (mode === 'metadata-only' || mode === 'off') return undefined;
  return mode === 'development-verbose' ? policy.scrub(value) : policy.payload(value);
}

/** Re-sanitizes one diagnostic's payload fields for the target mode; ids/timings survive. */
function sanitizeEvent(event: DiagnosticEvent, mode: TelemetryMode, policy: RedactionPolicy): DiagnosticEvent | undefined {
  const p = (value: unknown): unknown => sanitizePayload(value, mode, policy);
  const text = (value: string | undefined): string | undefined => p(value) as string | undefined;
  switch (event.type) {
    case 'protocol.event':
    case 'log':
      // Consistent with recording: metadata-only keeps no wire content or log lines.
      if (mode === 'metadata-only') return undefined;
      return (mode === 'development-verbose' ? policy.scrub(event) : policy.payload(event)) as DiagnosticEvent;
    case 'model.call':
      return { ...event, request: p(event.request), responseText: text(event.responseText), responseToolCalls: p(event.responseToolCalls) as typeof event.responseToolCalls };
    case 'tool.execution':
      return { ...event, arguments: p(event.arguments), result: p(event.result) };
    case 'memory.operation':
    case 'state.patch':
      return { ...event, value: p(event.value) };
    case 'generative_ui.request':
      return { ...event, props: p(event.props) };
    case 'context.resolved':
      return { ...event, included: event.included.map((item) => ({ ...item, text: text(item.text) })) };
    case 'rag.retrieval':
      return { ...event, query: text(event.query), candidates: event.candidates.map((candidate) => ({ ...candidate, excerpt: text(candidate.excerpt) })) };
    case 'span':
      return { ...event, attributes: policy.scrub(event.attributes) as SpanDiagnostic['attributes'], error: event.error === undefined ? undefined : (policy.scrub(event.error) as string) };
    case 'run':
    case 'security.decision':
    case 'approval':
    case 'metric':
      return policy.scrub(event) as DiagnosticEvent;
  }
}

export interface ExportBundleOptions {
  /** Defaults to `redacted`; never more permissive than the recording's own mode. */
  readonly mode?: TelemetryMode;
  readonly now?: () => Date;
}

/** A shareable, sanitized snapshot for bug reports (Section 166-168). */
export function exportBundle(snapshot: DiagnosticsSnapshot, options: ExportBundleOptions = {}): DebugBundle {
  const mode = stricterMode(options.mode ?? 'redacted', snapshot.mode);
  const policy = createRedactionPolicy({ mode: mode === 'off' ? 'metadata-only' : mode });
  const events = mode === 'off' ? [] : snapshot.events.flatMap((event) => sanitizeEvent(event, mode, policy) ?? []);
  const spans = mode === 'off' ? [] : snapshot.spans.map((span) => sanitizeEvent(span, mode, policy) as SpanDiagnostic);
  const runIds = [...new Set(events.flatMap((event) => (event.type === 'run' && event.correlation.runId ? [event.correlation.runId] : [])))];
  return {
    format: 'gixcopilot.devtools.bundle',
    version: 1,
    exportedAt: (options.now ?? ((): Date => new Date()))().toISOString(),
    mode,
    recordedMode: snapshot.mode,
    metadata: {
      diagnosticVersion: DIAGNOSTIC_VERSION,
      runIds,
      eventCount: events.length,
      spanCount: spans.length,
      note: 'Engineering diagnostics only - not an audit record. Importing this bundle displays data; it never executes anything.',
    },
    snapshot: { startedAt: snapshot.startedAt, mode, events, spans, dropped: snapshot.dropped },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const MODES = new Set<TelemetryMode>(['off', 'metadata-only', 'redacted', 'development-verbose']);

/**
 * Parses a bundle back into inert data (Section 167). Structure is validated; nothing in it
 * is ever evaluated, replayed or executed. Throws a descriptive error on anything malformed.
 */
export function importBundle(input: unknown): DebugBundle {
  const value: unknown = typeof input === 'string' ? JSON.parse(input) : input;
  if (!isRecord(value) || value['format'] !== 'gixcopilot.devtools.bundle') throw new Error('Not a DevTools debug bundle.');
  if (value['version'] !== 1) throw new Error(`Unsupported bundle version: ${String(value['version'])}.`);
  const snapshot = value['snapshot'];
  if (!isRecord(snapshot) || !Array.isArray(snapshot['events']) || !Array.isArray(snapshot['spans'])) throw new Error('Bundle snapshot is malformed.');
  const mode = value['mode'];
  if (typeof mode !== 'string' || !MODES.has(mode as TelemetryMode)) throw new Error('Bundle mode is invalid.');
  const valid = (entry: unknown): boolean =>
    isRecord(entry) && typeof entry['type'] === 'string' && typeof entry['id'] === 'string' && typeof entry['timestamp'] === 'string' && isRecord(entry['correlation']);
  if (!snapshot['events'].every(valid) || !snapshot['spans'].every(valid)) throw new Error('Bundle contains malformed diagnostics.');
  return value as unknown as DebugBundle;
}
