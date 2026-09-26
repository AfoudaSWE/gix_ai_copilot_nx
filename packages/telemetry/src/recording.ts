import type { MetricRecord, SpanHandle, SpanStatus, StartSpanOptions, TelemetryAdapter } from './adapter.js';
import { compactAttributes, correlationAttributes } from './conventions.js';
import type { Attributes, AttributeValue } from './conventions.js';
import { diagnostic } from './diagnostics.js';
import type { DiagnosticEvent, SpanDiagnostic } from './diagnostics.js';
import { createMetricsCollector } from './metrics.js';
import type { MetricsSummary } from './metrics.js';
import { createRedactionPolicy } from './redaction.js';
import type { RedactionPolicy, TelemetryMode } from './redaction.js';
import type { TraceSampler } from './sampling.js';

export interface RecordingTelemetryOptions {
  readonly mode?: TelemetryMode;
  readonly redaction?: RedactionPolicy;
  /** Ring-buffer capacity for events and spans (Section 170) - oldest dropped first. */
  readonly capacity?: number;
  readonly now?: () => Date;
  /** Deterministic id source for tests (Section 87). */
  readonly nextId?: () => string;
  /** Head sampling for spans (Section 159). Diagnostic events are never sampled - DevTools
   * inspectors and evals need the complete record even when most traces are dropped. */
  readonly shouldSample?: TraceSampler;
}

export interface TelemetrySession {
  readonly startedAt: string;
  readonly mode: TelemetryMode;
  readonly events: readonly DiagnosticEvent[];
  readonly spans: readonly SpanDiagnostic[];
  readonly metrics: MetricsSummary;
  readonly dropped: number;
}

export type TelemetryListener = (event: DiagnosticEvent) => void;

export interface RecordingTelemetry extends TelemetryAdapter {
  session(): TelemetrySession;
  subscribe(listener: TelemetryListener): () => void;
  clear(): void;
}

interface OpenSpan {
  readonly handle: SpanHandle;
  attributes: Record<string, AttributeValue>;
  readonly events: { readonly name: string; readonly attributes: Record<string, AttributeValue>; readonly at: number }[];
}

/**
 * The in-memory adapter DevTools and the test harness are built on (Section 23, 157): every
 * span start/end, diagnostic event and metric is kept in bounded buffers, redacted per mode
 * before it is ever stored, and observable through `subscribe`.
 */
export function createRecordingTelemetry(options: RecordingTelemetryOptions = {}): RecordingTelemetry {
  const redaction = options.redaction ?? createRedactionPolicy({ mode: options.mode });
  const capacity = options.capacity ?? 5_000;
  const now = options.now ?? ((): Date => new Date());
  const nextId = options.nextId ?? ((): string => globalThis.crypto.randomUUID());
  const unsampled = new WeakSet<SpanHandle>();
  const startedAt = now().toISOString();
  const events: DiagnosticEvent[] = [];
  const spans: SpanDiagnostic[] = [];
  const metrics = createMetricsCollector();
  const listeners = new Set<TelemetryListener>();
  const open = new WeakMap<SpanHandle, OpenSpan>();
  let dropped = 0;

  function push(list: DiagnosticEvent[] | SpanDiagnostic[], entry: DiagnosticEvent): void {
    if (list.length >= capacity) {
      list.shift();
      dropped += 1;
    }
    (list as DiagnosticEvent[]).push(entry);
  }

  function emit(event: DiagnosticEvent): void {
    push(events, event);
    for (const listener of listeners) {
      try {
        listener(event);
      } catch {
        /* a listener must never break the runtime */
      }
    }
  }

  const enabled = redaction.mode !== 'off';

  return {
    enabled,
    redaction,
    startSpan(name: string, startOptions?: StartSpanOptions): SpanHandle {
      const startedAtMs = startOptions?.startedAt ?? now().getTime();
      const parent = startOptions?.parent;
      const spanId = nextId();
      const attributes = {
        ...correlationAttributes(startOptions?.correlation),
        ...compactAttributes(startOptions?.attributes),
      };
      const sampled = parent ? !unsampled.has(parent) : (options.shouldSample?.(name, attributes) ?? true);
      const record: OpenSpan = { handle: undefined as unknown as SpanHandle, attributes, events: [] };
      const handle: SpanHandle = {
        name,
        spanId,
        traceId: parent?.traceId ?? nextId(),
        parentSpanId: parent?.spanId,
        startedAt: startedAtMs,
        setAttributes(next: Attributes) {
          record.attributes = { ...record.attributes, ...compactAttributes(next) };
        },
        addEvent(eventName, eventAttributes) {
          record.events.push({ name: eventName, attributes: compactAttributes(eventAttributes), at: now().getTime() });
        },
        end(status: SpanStatus = 'ok', error?: unknown, endedAt?: number) {
          if (!enabled || !sampled) return;
          const endedAtMs = endedAt ?? now().getTime();
          const ended = diagnostic<SpanDiagnostic>(
            {
              type: 'span',
              name,
              phase: 'ended',
              spanId,
              traceId: handle.traceId,
              parentSpanId: handle.parentSpanId,
              startedAt: startedAtMs,
              endedAt: endedAtMs,
              durationMs: Math.max(0, endedAtMs - startedAtMs),
              status,
              attributes: redaction.scrub(record.attributes) as Record<string, AttributeValue>,
              error: error === undefined ? undefined : redaction.scrub(error instanceof Error ? error.message : typeof error === 'string' ? error : 'Unknown telemetry error') as string,
              correlation: startOptions?.correlation ?? {},
            },
            now,
          );
          push(spans, ended);
          emit(ended);
        },
      };
      (record as { handle: SpanHandle }).handle = handle;
      open.set(handle, record);
      if (!sampled) unsampled.add(handle);
      if (enabled && sampled) {
        emit(
          diagnostic<SpanDiagnostic>(
            {
              type: 'span',
              name,
              phase: 'started',
              spanId,
              traceId: handle.traceId,
              parentSpanId: handle.parentSpanId,
              startedAt: startedAtMs,
              attributes: redaction.scrub(attributes) as Record<string, AttributeValue>,
              correlation: startOptions?.correlation ?? {},
            },
            now,
          ),
        );
      }
      return handle;
    },
    recordEvent(event: DiagnosticEvent): void {
      if (!enabled) return;
      if (redaction.mode === 'metadata-only' && (event.type === 'protocol.event' || event.type === 'log')) return;
      emit((redaction.capturesPayloads ? redaction.payload(event) : redaction.scrub(event)) as DiagnosticEvent);
    },
    recordMetric(metric: MetricRecord): void {
      if (!enabled) return;
      metrics.record(metric);
    },
    session(): TelemetrySession {
      return { startedAt, mode: redaction.mode, events: [...events], spans: [...spans], metrics: metrics.summarize(), dropped };
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    clear() {
      events.length = 0;
      spans.length = 0;
      metrics.reset();
      dropped = 0;
    },
  };
}
