import { SpanStatusCode, context as otelContext, metrics as otelMetrics, trace } from '@opentelemetry/api';
import type { Context, Counter, Histogram, Span, UpDownCounter } from '@opentelemetry/api';
import type { SpanHandle, SpanStatus, StartSpanOptions, TelemetryAdapter } from './adapter.js';
import { compactAttributes, correlationAttributes } from './conventions.js';
import type { Attributes } from './conventions.js';
import { createRedactionPolicy } from './redaction.js';
import type { RedactionPolicy, TelemetryMode } from './redaction.js';

export interface OpenTelemetryAdapterOptions {
  readonly instrumentationName?: string;
  readonly mode?: TelemetryMode;
  readonly redaction?: RedactionPolicy;
  /** Head sampling (Section 159): return `false` to drop a root span and its whole subtree.
   * Child spans of an unsampled parent are never sampled regardless. */
  readonly shouldSample?: (name: string, attributes: Readonly<Record<string, string | number | boolean>>) => boolean;
}

const spanContexts = new WeakMap<SpanHandle, Context>();
const unsampled = new WeakSet<SpanHandle>();

/**
 * The primary `TelemetryAdapter` (Section 153, 155): spans via `@opentelemetry/api`'s
 * tracer, metrics via its meter. No SDK/exporter is bundled - with nothing registered the
 * API's own no-op provider makes every call near-free, and a host configures OTLP or any
 * backend itself (Section 156: never a required SaaS credential).
 */
export function createOpenTelemetryAdapter(options: OpenTelemetryAdapterOptions = {}): TelemetryAdapter {
  const name = options.instrumentationName ?? '@gixcopilot/telemetry';
  const tracer = trace.getTracer(name);
  const meter = otelMetrics.getMeter(name);
  const counters = new Map<string, Counter>();
  const histograms = new Map<string, Histogram>();
  const gauges = new Map<string, UpDownCounter>();
  const gaugeValues = new Map<string, number>();
  const redaction = options.redaction ?? createRedactionPolicy({ mode: options.mode });

  function wrap(span: Span, spanName: string, parent: SpanHandle | undefined, ctx: Context, startedAt: number): SpanHandle {
    const spanContext = span.spanContext();
    const handle: SpanHandle = {
      name: spanName,
      spanId: spanContext.spanId,
      traceId: spanContext.traceId,
      parentSpanId: parent?.spanId,
      startedAt,
      setAttributes(attributes: Attributes) {
        span.setAttributes(compactAttributes(attributes));
      },
      addEvent(eventName, attributes) {
        span.addEvent(eventName, compactAttributes(attributes));
      },
      end(status?: SpanStatus, error?: unknown, endedAt?: number) {
        if (status === 'error') {
          if (error !== undefined) span.recordException(error instanceof Error ? error : new Error(typeof error === 'string' ? error : 'Unknown telemetry error'));
          span.setStatus({ code: SpanStatusCode.ERROR, message: error instanceof Error ? error.message : undefined });
        } else if (status === 'cancelled') {
          span.setStatus({ code: SpanStatusCode.ERROR, message: 'cancelled' });
        } else {
          span.setStatus({ code: SpanStatusCode.OK });
        }
        span.end(endedAt);
      },
    };
    spanContexts.set(handle, trace.setSpan(ctx, span));
    return handle;
  }

  function unsampledHandle(spanName: string, parent: SpanHandle | undefined, startedAt: number): SpanHandle {
    const handle: SpanHandle = {
      name: spanName,
      spanId: 'unsampled',
      traceId: parent?.traceId ?? 'unsampled',
      parentSpanId: parent?.spanId,
      startedAt,
      setAttributes() {
        /* dropped */
      },
      addEvent() {
        /* dropped */
      },
      end() {
        /* dropped */
      },
    };
    unsampled.add(handle);
    return handle;
  }

  return {
    enabled: redaction.mode !== 'off',
    redaction,
    startSpan(spanName: string, startOptions?: StartSpanOptions): SpanHandle {
      const startedAt = startOptions?.startedAt ?? Date.now();
      const parent = startOptions?.parent;
      const attributes = { ...correlationAttributes(startOptions?.correlation), ...compactAttributes(startOptions?.attributes) };
      if (parent && unsampled.has(parent)) return unsampledHandle(spanName, parent, startedAt);
      if (!parent && options.shouldSample && !options.shouldSample(spanName, attributes)) {
        return unsampledHandle(spanName, undefined, startedAt);
      }
      const parentContext = (parent && spanContexts.get(parent)) ?? otelContext.active();
      const span = tracer.startSpan(spanName, { attributes, startTime: startedAt }, parentContext);
      return wrap(span, spanName, parent, parentContext, startedAt);
    },
    recordEvent(): void {
      // Diagnostic events are a DevTools concern; OpenTelemetry carries their essence as
      // span attributes/events already recorded by the instrumentation wrappers.
    },
    recordMetric(metric): void {
      const attributes = compactAttributes(metric.attributes);
      switch (metric.kind) {
        case 'counter': {
          let counter = counters.get(metric.name);
          if (!counter) {
            counter = meter.createCounter(metric.name);
            counters.set(metric.name, counter);
          }
          counter.add(metric.value, attributes);
          break;
        }
        case 'histogram': {
          let histogram = histograms.get(metric.name);
          if (!histogram) {
            histogram = meter.createHistogram(metric.name);
            histograms.set(metric.name, histogram);
          }
          histogram.record(metric.value, attributes);
          break;
        }
        case 'gauge': {
          let gauge = gauges.get(metric.name);
          if (!gauge) {
            gauge = meter.createUpDownCounter(metric.name);
            gauges.set(metric.name, gauge);
          }
          const key = `${metric.name}:${JSON.stringify(attributes)}`;
          const previous = gaugeValues.get(key) ?? 0;
          gauge.add(metric.value - previous, attributes);
          gaugeValues.set(key, metric.value);
          break;
        }
      }
    },
  };
}
