import type { Attributes, AttributeValue, Correlation } from './conventions.js';
import type { DiagnosticEvent } from './diagnostics.js';
import type { RedactionPolicy } from './redaction.js';

export type SpanStatus = 'ok' | 'error' | 'cancelled';

/**
 * A started span (Section 153). Parent/child linking is explicit - a caller passes the
 * parent `SpanHandle` into `startSpan` - rather than relying on ambient context propagation,
 * for the same reason `@gixcopilot/agents`' Phase 10 tracing did: the runtimes are deeply
 * recursive async functions where explicit threading is easier to reason about and test.
 */
export interface SpanHandle {
  readonly name: string;
  readonly spanId: string;
  readonly traceId: string;
  readonly parentSpanId?: string;
  readonly startedAt: number;
  setAttributes(attributes: Attributes): void;
  addEvent(name: string, attributes?: Attributes): void;
  end(status?: SpanStatus, error?: unknown, endedAt?: number): void;
}

export interface StartSpanOptions {
  readonly parent?: SpanHandle;
  readonly attributes?: Attributes;
  readonly correlation?: Correlation;
  /** Explicit start time (epoch ms) for spans recorded retroactively, e.g. a workflow's
   * approval wait that spanned a process boundary. */
  readonly startedAt?: number;
}

export interface MetricRecord {
  readonly name: string;
  readonly value: number;
  readonly kind: 'counter' | 'histogram' | 'gauge';
  readonly attributes: Readonly<Record<string, AttributeValue>>;
}

/**
 * The observability port every runtime layer talks to (Section 153). OpenTelemetry is the
 * primary implementation (`createOpenTelemetryAdapter`); the in-memory recorder
 * (`createRecordingTelemetry`) powers DevTools and the test harness; `createNoopTelemetry`
 * is the safe default that costs effectively nothing (Section 154).
 */
export interface TelemetryAdapter {
  readonly enabled: boolean;
  /** The redaction policy instrumentation wrappers apply before handing this adapter any
   * payload (Section 14). Absent on the no-op adapter; a composed adapter uses the strictest
   * of its members'. */
  readonly redaction?: RedactionPolicy;
  startSpan(name: string, options?: StartSpanOptions): SpanHandle;
  recordEvent(event: DiagnosticEvent): void;
  recordMetric(metric: MetricRecord): void;
}

let noopCounter = 0;

const NOOP_SPAN_PROTOTYPE = {
  setAttributes(): void {
    /* no-op */
  },
  addEvent(): void {
    /* no-op */
  },
  end(): void {
    /* no-op */
  },
};

function noopSpan(name: string, parent: SpanHandle | undefined): SpanHandle {
  noopCounter += 1;
  return Object.assign(Object.create(NOOP_SPAN_PROTOTYPE) as SpanHandle, {
    name,
    spanId: `noop-${noopCounter}`,
    traceId: parent?.traceId ?? 'noop',
    parentSpanId: parent?.spanId,
    startedAt: 0,
  });
}

/** Never records anything; span handles are cheap prototype-shared objects (Section 154). */
export function createNoopTelemetry(): TelemetryAdapter {
  return {
    enabled: false,
    startSpan: (name, options) => noopSpan(name, options?.parent),
    recordEvent(): void {
      /* no-op */
    },
    recordMetric(): void {
      /* no-op */
    },
  };
}

/** Fans one call out to several adapters (e.g. OpenTelemetry export + a DevTools recorder).
 * A throwing adapter never breaks the others or the runtime. */
export function composeTelemetry(adapters: readonly TelemetryAdapter[]): TelemetryAdapter {
  const active = adapters.filter((adapter) => adapter.enabled);
  if (active.length === 0) return createNoopTelemetry();
  if (active.length === 1) return active[0] ?? createNoopTelemetry();

  const guard = (work: () => void): void => {
    try {
      work();
    } catch {
      /* telemetry must never break the hot path */
    }
  };

  return {
    enabled: true,
    redaction: strictestRedaction(active),
    startSpan(name, options) {
      const parentHandles = options?.parent ? compositeParents.get(options.parent) : undefined;
      const handles = active.map((adapter, index) =>
        adapter.startSpan(name, { ...options, parent: parentHandles?.[index] }),
      );
      const primary = handles[0] ?? noopSpan(name, options?.parent);
      const composite: SpanHandle = {
        name,
        spanId: primary.spanId,
        traceId: primary.traceId,
        parentSpanId: primary.parentSpanId,
        startedAt: primary.startedAt,
        setAttributes: (attributes) => handles.forEach((handle) => guard(() => handle.setAttributes(attributes))),
        addEvent: (eventName, attributes) => handles.forEach((handle) => guard(() => handle.addEvent(eventName, attributes))),
        end: (status, error, endedAt) => handles.forEach((handle) => guard(() => handle.end(status, error, endedAt))),
      };
      compositeParents.set(composite, handles);
      return composite;
    },
    recordEvent: (event) => active.forEach((adapter) => guard(() => adapter.recordEvent(event))),
    recordMetric: (metric) => active.forEach((adapter) => guard(() => adapter.recordMetric(metric))),
  };
}

const compositeParents = new WeakMap<SpanHandle, readonly SpanHandle[]>();

const MODE_STRICTNESS = { off: 0, 'metadata-only': 1, redacted: 2, 'development-verbose': 3 } as const;

function strictestRedaction(adapters: readonly TelemetryAdapter[]): RedactionPolicy | undefined {
  let strictest: RedactionPolicy | undefined;
  for (const adapter of adapters) {
    const policy = adapter.redaction;
    if (!policy) continue;
    if (!strictest || MODE_STRICTNESS[policy.mode] < MODE_STRICTNESS[strictest.mode]) strictest = policy;
  }
  return strictest;
}
