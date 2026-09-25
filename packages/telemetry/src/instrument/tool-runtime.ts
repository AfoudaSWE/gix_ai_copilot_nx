import { CopilotError } from '@gixcopilot/protocol';
import type { PublicCopilotError } from '@gixcopilot/protocol';
import type { TelemetryAdapter } from '../adapter.js';
import { ATTR, SPAN_NAMES } from '../conventions.js';
import { diagnostic } from '../diagnostics.js';
import type { SecurityDecisionDiagnostic, ToolExecutionDiagnostic, ToolPhaseTiming } from '../diagnostics.js';
import { METRICS } from '../metrics.js';
import { readTelemetryMetadata } from './telemetry-metadata.js';

/** Structural subsets of `@gixcopilot/tools` shapes - duck-typed, never imported. */
export interface ToolInvocationLike {
  readonly toolCallId: string;
  readonly name: string;
  readonly arguments: unknown;
  readonly context: {
    readonly runId: string;
    readonly threadId?: string;
    readonly signal: AbortSignal;
    readonly metadata?: Readonly<Record<string, unknown>>;
  };
}

export type ToolResultLike =
  | { readonly status: 'success'; readonly toolCallId: string; readonly data: unknown }
  | { readonly status: 'error'; readonly toolCallId: string; readonly error: PublicCopilotError };

export interface ToolRuntimeLike {
  execute(request: ToolInvocationLike): Promise<ToolResultLike>;
}

export type ToolRuntimeMiddlewareLike = (invocation: ToolInvocationLike, next: () => Promise<ToolResultLike>) => Promise<ToolResultLike>;

export type ToolRuntimeEventLike =
  | { readonly phase: 'started'; readonly toolCallId: string; readonly name: string }
  | { readonly phase: 'completed'; readonly toolCallId: string; readonly name: string; readonly result: unknown }
  | { readonly phase: 'failed'; readonly toolCallId: string; readonly name: string; readonly error: PublicCopilotError };

interface TrackedToolCall {
  readonly startedAt: number;
  readonly phases: ToolPhaseTiming[];
  security?: Pick<SecurityDecisionDiagnostic, 'decision' | 'reasonCode' | 'approvalLevel'>;
  source?: string;
}

/**
 * Shared per-`toolCallId` bookkeeping so the tool wrapper, the firewall bridge and the
 * runtime's own lifecycle listener assemble ONE tool timeline (Section 37-38): requested →
 * authorization (from the firewall) → validation/execution (from `ToolRuntime.onEvent`) →
 * completed/failed. Entries are removed when the call settles.
 */
export interface ToolCallTracker {
  begin(toolCallId: string, now: number): TrackedToolCall;
  mark(toolCallId: string, phase: ToolPhaseTiming['phase'], now: number): void;
  security(toolCallId: string, decision: TrackedToolCall['security']): void;
  source(toolCallId: string, source: string | undefined): void;
  finish(toolCallId: string): TrackedToolCall | undefined;
  peek(toolCallId: string): TrackedToolCall | undefined;
}

export function createToolCallTracker(): ToolCallTracker {
  const calls = new Map<string, TrackedToolCall>();
  return {
    begin(toolCallId, now) {
      const entry: TrackedToolCall = { startedAt: now, phases: [{ phase: 'requested', atMs: 0 }] };
      calls.set(toolCallId, entry);
      return entry;
    },
    mark(toolCallId, phase, now) {
      const entry = calls.get(toolCallId);
      if (!entry) return;
      entry.phases.push({ phase, atMs: Math.max(0, now - entry.startedAt) });
    },
    security(toolCallId, decision) {
      const entry = calls.get(toolCallId);
      if (entry) entry.security = decision;
    },
    source(toolCallId, source) {
      const entry = calls.get(toolCallId);
      if (entry && source) entry.source = source;
    },
    finish(toolCallId) {
      const entry = calls.get(toolCallId);
      calls.delete(toolCallId);
      return entry;
    },
    peek(toolCallId) {
      return calls.get(toolCallId);
    },
  };
}

export interface ToolTelemetryOptions {
  readonly tracker?: ToolCallTracker;
  readonly now?: () => number;
}

export interface ToolTelemetry {
  readonly tracker: ToolCallTracker;
  /** Wraps `execute()` in a `tool.execute` span and emits one `tool.execution` diagnostic. */
  instrument<T extends ToolRuntimeLike>(runtime: T): T;
  /** Place LAST in `createToolRuntime({ middleware })` - marks when the chain hands over to the
   * runtime's own validate → execute core (the firewall, placed before it, has already run). */
  readonly middleware: ToolRuntimeMiddlewareLike;
  /** Pass as `createToolRuntime({ onEvent })` - marks execution start (validation passed). */
  readonly onEvent: (event: ToolRuntimeEventLike) => void;
}

export function createToolTelemetry(telemetry: TelemetryAdapter, options: ToolTelemetryOptions = {}): ToolTelemetry {
  const tracker = options.tracker ?? createToolCallTracker();
  const now = options.now ?? ((): number => Date.now());

  return {
    tracker,
    middleware: (invocation, next) => {
      tracker.mark(invocation.toolCallId, 'validation', now());
      return next();
    },
    onEvent: (event) => {
      if (event.phase === 'started') tracker.mark(event.toolCallId, 'execution', now());
    },
    instrument<T extends ToolRuntimeLike>(runtime: T): T {
      if (!telemetry.enabled) return runtime;
      const instrumented: ToolRuntimeLike = {
        async execute(request) {
          const meta = readTelemetryMetadata(request.context.metadata);
          const startedAt = now();
          const correlation = {
            runId: request.context.runId,
            threadId: request.context.threadId,
            ...meta?.correlation,
          };
          const span = telemetry.startSpan(SPAN_NAMES.toolExecute, {
            parent: meta?.parentSpan,
            correlation,
            startedAt,
            attributes: { [ATTR.toolName]: request.name, [ATTR.toolCallId]: request.toolCallId },
          });
          tracker.begin(request.toolCallId, startedAt);
          let result: ToolResultLike;
          try {
            result = await runtime.execute(request);
          } catch (caught) {
            const error = CopilotError.isCopilotError(caught)
              ? caught.toPublicJSON()
              : CopilotError.internal(caught instanceof Error ? caught.message : String(caught)).toPublicJSON();
            result = { status: 'error', toolCallId: request.toolCallId, error };
            finalize(result);
            throw caught;
          }
          finalize(result);
          return result;

          function finalize(settled: ToolResultLike): void {
            const endedAt = now();
            tracker.mark(request.toolCallId, settled.status === 'success' ? 'completed' : 'failed', endedAt);
            const tracked = tracker.finish(request.toolCallId);
            const durationMs = endedAt - startedAt;
            const status = settled.status === 'success' ? 'succeeded' : 'failed';
            const redaction = telemetry.redaction;
            span.setAttributes({
              [ATTR.status]: status,
              [ATTR.latencyMs]: durationMs,
              [ATTR.toolSource]: tracked?.source,
              [ATTR.securityDecision]: tracked?.security?.decision,
              [ATTR.securityReasonCode]: tracked?.security?.reasonCode,
              [ATTR.errorCode]: settled.status === 'error' ? settled.error.code : undefined,
            });
            span.end(status === 'succeeded' ? 'ok' : settled.status === 'error' && settled.error.code === 'CANCELLED' ? 'cancelled' : 'error', settled.status === 'error' ? settled.error.message : undefined);
            telemetry.recordEvent(
              diagnostic<ToolExecutionDiagnostic>({
                type: 'tool.execution',
                correlation: { ...correlation, traceId: span.traceId, spanId: span.spanId, parentSpanId: span.parentSpanId },
                toolCallId: request.toolCallId,
                name: request.name,
                source: tracked?.source,
                status,
                durationMs,
                phases: tracked?.phases ?? [{ phase: 'requested', atMs: 0 }],
                securityDecision: tracked?.security?.decision,
                securityReasonCode: tracked?.security?.reasonCode,
                approvalLevel: tracked?.security?.approvalLevel,
                error: settled.status === 'error' ? settled.error : undefined,
                arguments: redaction?.payload(request.arguments),
                result: settled.status === 'success' ? redaction?.payload(settled.data) : undefined,
              }),
            );
            const attributes = { [ATTR.toolName]: request.name, [ATTR.status]: status };
            telemetry.recordMetric({ name: METRICS.toolCalls, kind: 'counter', value: 1, attributes });
            telemetry.recordMetric({ name: METRICS.toolLatencyMs, kind: 'histogram', value: durationMs, attributes });
            if (status === 'failed') {
              telemetry.recordMetric({ name: METRICS.errors, kind: 'counter', value: 1, attributes: { kind: 'tool', code: settled.status === 'error' ? settled.error.code : 'unknown' } });
              if (settled.status === 'error' && settled.error.code === 'TIMEOUT') {
                telemetry.recordMetric({ name: METRICS.timeouts, kind: 'counter', value: 1, attributes: { kind: 'tool' } });
              }
            }
          }
        },
      };
      return Object.assign(Object.create(Object.getPrototypeOf(runtime) as object) as T, runtime, instrumented);
    },
  };
}
