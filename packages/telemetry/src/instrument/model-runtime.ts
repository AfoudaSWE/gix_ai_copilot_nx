import { CopilotError } from '@gixcopilot/protocol';
import type { FinishReason, PublicCopilotError, Usage } from '@gixcopilot/protocol';
import type { TelemetryAdapter } from '../adapter.js';
import { ATTR, SPAN_NAMES } from '../conventions.js';
import { diagnostic } from '../diagnostics.js';
import type { ModelCallDiagnostic } from '../diagnostics.js';
import { METRICS } from '../metrics.js';
import { readTelemetryMetadata, stripTelemetryMetadata } from './telemetry-metadata.js';

/** Structural subset of `@gixcopilot/provider`'s `ModelStreamEvent` this wrapper reads. */
export type ModelStreamEventLike =
  | { readonly type: 'model.started' }
  | { readonly type: 'content.delta'; readonly delta: string }
  | { readonly type: 'usage.updated'; readonly usage: Usage }
  | { readonly type: 'tool_call.requested'; readonly toolCall: { readonly id: string; readonly name: string; readonly arguments: unknown } }
  | { readonly type: 'model.completed'; readonly finishReason: FinishReason; readonly usage?: Usage }
  | { readonly type: 'model.failed'; readonly error: PublicCopilotError };

export interface ModelExecutionRequestLike {
  readonly model?: { readonly provider: string; readonly model: string };
  readonly messages: readonly unknown[];
  readonly temperature?: number;
  readonly maxOutputTokens?: number;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly signal?: AbortSignal;
}

/** Structural subset of `ModelRuntime` - duck-typed so this package never depends on
 * `@gixcopilot/provider` (the same pattern `rag` uses to avoid depending on `context`). */
export interface ModelRuntimeLike<TRequest extends ModelExecutionRequestLike, TEvent extends ModelStreamEventLike> {
  stream(request: TRequest): AsyncGenerator<TEvent, void, undefined>;
}

export interface InstrumentModelRuntimeOptions {
  /** What the runtime falls back to when a request carries no `model` - reported on spans. */
  readonly defaultModel?: { readonly provider?: string; readonly model?: string };
  readonly now?: () => number;
}

/**
 * Wraps `stream()` in a `model.call` span (Section 10, 12, 17) and emits one
 * `model.call` diagnostic per call - provider/model, usage, latency, time to first chunk,
 * finish reason, requested tool calls, and (per redaction mode) the request/response.
 * Correlation and the parent span come from `request.metadata[TELEMETRY_METADATA_KEY]`.
 */
export function instrumentModelRuntime<TRequest extends ModelExecutionRequestLike, TEvent extends ModelStreamEventLike, TRuntime extends ModelRuntimeLike<TRequest, TEvent>>(
  runtime: TRuntime,
  telemetry: TelemetryAdapter,
  options: InstrumentModelRuntimeOptions = {},
): TRuntime {
  if (!telemetry.enabled) return runtime;
  const now = options.now ?? ((): number => Date.now());

  const instrumented: ModelRuntimeLike<TRequest, TEvent> = {
    async *stream(request: TRequest): AsyncGenerator<TEvent, void, undefined> {
      const meta = readTelemetryMetadata(request.metadata);
      const provider = request.model?.provider ?? options.defaultModel?.provider;
      const model = request.model?.model ?? options.defaultModel?.model;
      const startedAt = now();
      const span = telemetry.startSpan(SPAN_NAMES.modelCall, {
        parent: meta?.parentSpan,
        correlation: meta?.correlation,
        startedAt,
        attributes: {
          [ATTR.modelProvider]: provider,
          [ATTR.modelName]: model,
        },
      });

      let attempts = 0;
      let firstChunkAt: number | undefined;
      let usage: Usage | undefined;
      let finishReason: FinishReason | undefined;
      let error: PublicCopilotError | undefined;
      let text = '';
      const toolCalls: { id: string; name: string; arguments: unknown }[] = [];
      let status: ModelCallDiagnostic['status'] = 'completed';

      try {
        for await (const event of runtime.stream(request)) {
          switch (event.type) {
            case 'model.started':
              attempts += 1;
              break;
            case 'content.delta':
              if (firstChunkAt === undefined) firstChunkAt = now();
              text += event.delta;
              break;
            case 'usage.updated':
              usage = event.usage;
              break;
            case 'tool_call.requested':
              if (firstChunkAt === undefined) firstChunkAt = now();
              toolCalls.push(event.toolCall);
              break;
            case 'model.completed':
              finishReason = event.finishReason;
              usage = event.usage ?? usage;
              break;
            case 'model.failed':
              error = event.error;
              status = event.error.code === 'CANCELLED' ? 'cancelled' : 'failed';
              break;
          }
          yield event;
        }
      } catch (caught) {
        status = request.signal?.aborted ? 'cancelled' : 'failed';
        error = error ?? (CopilotError.isCopilotError(caught) ? caught.toPublicJSON() : CopilotError.internal(caught instanceof Error ? caught.message : String(caught)).toPublicJSON());
        throw caught;
      } finally {
        const endedAt = now();
        const latencyMs = endedAt - startedAt;
        const redaction = telemetry.redaction;
        span.setAttributes({
          [ATTR.tokensInput]: usage?.inputTokens,
          [ATTR.tokensOutput]: usage?.outputTokens,
          [ATTR.tokensTotal]: usage?.totalTokens,
          [ATTR.latencyMs]: latencyMs,
          [ATTR.timeToFirstChunkMs]: firstChunkAt === undefined ? undefined : firstChunkAt - startedAt,
          [ATTR.finishReason]: finishReason,
          [ATTR.status]: status,
          [ATTR.errorCode]: error?.code,
          [ATTR.attempt]: Math.max(1, attempts),
        });
        span.end(status === 'completed' ? 'ok' : status === 'cancelled' ? 'cancelled' : 'error', error?.message);

        telemetry.recordEvent(
          diagnostic<ModelCallDiagnostic>({
            type: 'model.call',
            correlation: { ...meta?.correlation, traceId: span.traceId, spanId: span.spanId, parentSpanId: span.parentSpanId },
            provider,
            model,
            status,
            attempts: Math.max(1, attempts),
            latencyMs,
            timeToFirstChunkMs: firstChunkAt === undefined ? undefined : firstChunkAt - startedAt,
            usage,
            finishReason,
            toolCallsRequested: toolCalls.map((call) => call.name),
            error,
            temperature: request.temperature,
            maxOutputTokens: request.maxOutputTokens,
            messageCount: request.messages.length,
            request: redaction?.payload({ messages: request.messages, metadata: stripTelemetryMetadata(request.metadata) }),
            responseText: redaction?.text(text === '' ? undefined : text),
            responseToolCalls: redaction?.capturesPayloads
              ? toolCalls.map((call) => ({ id: call.id, name: call.name, arguments: redaction.payload(call.arguments) }))
              : toolCalls.map((call) => ({ id: call.id, name: call.name })),
          }),
        );

        const metricAttributes = { [ATTR.modelProvider]: provider ?? 'unknown', [ATTR.modelName]: model ?? 'unknown', [ATTR.status]: status };
        telemetry.recordMetric({ name: METRICS.modelCalls, kind: 'counter', value: 1, attributes: metricAttributes });
        telemetry.recordMetric({ name: METRICS.modelLatencyMs, kind: 'histogram', value: latencyMs, attributes: metricAttributes });
        if (firstChunkAt !== undefined) {
          telemetry.recordMetric({ name: METRICS.modelFirstChunkMs, kind: 'histogram', value: firstChunkAt - startedAt, attributes: metricAttributes });
        }
        if (usage) {
          telemetry.recordMetric({ name: METRICS.tokensInput, kind: 'counter', value: usage.inputTokens, attributes: metricAttributes });
          telemetry.recordMetric({ name: METRICS.tokensOutput, kind: 'counter', value: usage.outputTokens, attributes: metricAttributes });
        }
        if (attempts > 1) {
          telemetry.recordMetric({ name: METRICS.modelRetries, kind: 'counter', value: attempts - 1, attributes: metricAttributes });
        }
        if (status === 'failed') telemetry.recordMetric({ name: METRICS.errors, kind: 'counter', value: 1, attributes: { kind: 'model', code: error?.code ?? 'unknown' } });
        if (status === 'cancelled') telemetry.recordMetric({ name: METRICS.cancellations, kind: 'counter', value: 1, attributes: { kind: 'model' } });
      }
    },
  };

  // Preserve every other member (e.g. `registry`) of the wrapped runtime.
  return Object.assign(Object.create(Object.getPrototypeOf(runtime) as object) as TRuntime, runtime, instrumented);
}

/** Structural subset of `@gixcopilot/provider`'s `ModelRuntimeTelemetryEvent`. */
export type ModelRuntimeTelemetryEventLike =
  | { readonly type: 'attempt_started'; readonly provider: string; readonly model: string; readonly attempt: number; readonly maxAttempts: number }
  | { readonly type: 'attempt_succeeded'; readonly provider: string; readonly model: string; readonly attempt: number }
  | { readonly type: 'attempt_failed'; readonly provider: string; readonly model: string; readonly attempt: number; readonly maxAttempts: number; readonly code: string; readonly retryable: boolean; readonly willRetry: boolean }
  | { readonly type: 'completed'; readonly provider: string; readonly model: string; readonly attempts: number }
  | { readonly type: 'failed'; readonly provider: string; readonly model: string; readonly attempts: number; readonly code: string };

/** A listener for `createModelRuntime({ onTelemetry })` that turns retry/timeout attempts
 * into metrics - the runtime's own retry loop is the only place those are visible. */
export function createModelRuntimeTelemetryListener(telemetry: TelemetryAdapter): (event: ModelRuntimeTelemetryEventLike) => void {
  return (event) => {
    if (!telemetry.enabled) return;
    const attributes = { [ATTR.modelProvider]: event.provider, [ATTR.modelName]: event.model };
    if (event.type === 'attempt_failed') {
      if (event.willRetry) telemetry.recordMetric({ name: METRICS.retries, kind: 'counter', value: 1, attributes: { ...attributes, kind: 'model' } });
      if (event.code === 'TIMEOUT') telemetry.recordMetric({ name: METRICS.timeouts, kind: 'counter', value: 1, attributes: { ...attributes, kind: 'model' } });
    }
  };
}
