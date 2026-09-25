import type { CopilotEvent, PublicCopilotError, Usage } from '@gixcopilot/protocol';
import type { TelemetryAdapter } from '../adapter.js';
import type { Correlation } from '../conventions.js';
import { diagnostic } from '../diagnostics.js';
import type { GenerativeUiRequestDiagnostic, ProtocolEventDiagnostic, RunDiagnostic } from '../diagnostics.js';
import { METRICS } from '../metrics.js';

/** Wraps a public protocol event into the diagnostics channel - the DevTools Messages and
 * Events views are built from exactly what a client received (devtools skill: no parallel
 * instrumentation path). */
export function recordProtocolEvent(telemetry: TelemetryAdapter, event: CopilotEvent, correlation?: Correlation): void {
  if (!telemetry.enabled) return;
  telemetry.recordEvent(
    diagnostic<ProtocolEventDiagnostic>({
      type: 'protocol.event',
      correlation: {
        runId: event.runId,
        threadId: event.threadId,
        rootRunId: event.rootRunId,
        parentRunId: event.parentRunId,
        ...correlation,
      },
      event,
    }),
  );

  // A generative UI request is a reserved `ui.render.<component>` tool call (Phase 6) - it
  // gets a first-class diagnostic so the Generative UI inspector doesn't have to re-parse
  // tool names.
  if (event.type === 'tool.requested' && event.name.startsWith('ui.render.')) {
    telemetry.recordEvent(
      diagnostic<GenerativeUiRequestDiagnostic>({
        type: 'generative_ui.request',
        correlation: { runId: event.runId, threadId: event.threadId },
        toolCallId: event.toolCallId,
        component: event.name.slice('ui.render.'.length),
        status: 'requested',
        props: telemetry.redaction?.payload(event.arguments),
      }),
    );
  } else if ((event.type === 'tool.completed' || event.type === 'tool.failed') && event.name.startsWith('ui.render.')) {
    telemetry.recordEvent(
      diagnostic<GenerativeUiRequestDiagnostic>({
        type: 'generative_ui.request',
        correlation: { runId: event.runId, threadId: event.threadId },
        toolCallId: event.toolCallId,
        component: event.name.slice('ui.render.'.length),
        status: event.type === 'tool.completed' ? 'validated' : 'failed',
        propsValid: event.type === 'tool.completed',
        error: event.type === 'tool.failed' ? event.error : undefined,
      }),
    );
  }
}

export interface RecordRunOptions {
  readonly kind: RunDiagnostic['kind'];
  readonly phase: RunDiagnostic['phase'];
  readonly correlation: Correlation;
  readonly label?: string;
  readonly usage?: Usage;
  readonly latencyMs?: number;
  readonly error?: PublicCopilotError;
}

export function recordRun(telemetry: TelemetryAdapter, options: RecordRunOptions): void {
  if (!telemetry.enabled) return;
  telemetry.recordEvent(
    diagnostic<RunDiagnostic>({
      type: 'run',
      correlation: options.correlation,
      kind: options.kind,
      phase: options.phase,
      label: options.label,
      usage: options.usage,
      latencyMs: options.latencyMs,
      error: options.error,
    }),
  );
  if (options.phase === 'started') {
    const name = options.kind === 'agent' ? METRICS.agentRuns : options.kind === 'workflow' ? METRICS.workflowRuns : METRICS.runs;
    telemetry.recordMetric({ name, kind: 'counter', value: 1, attributes: {} });
  } else if (options.latencyMs !== undefined) {
    const name = options.kind === 'agent' ? METRICS.agentLatencyMs : options.kind === 'workflow' ? METRICS.workflowLatencyMs : `${METRICS.runs}.latency_ms`;
    telemetry.recordMetric({ name, kind: 'histogram', value: options.latencyMs, attributes: { 'copilot.status': options.phase } });
  }
  if (options.phase === 'failed') telemetry.recordMetric({ name: METRICS.errors, kind: 'counter', value: 1, attributes: { kind: options.kind, code: options.error?.code ?? 'unknown' } });
  if (options.phase === 'cancelled') telemetry.recordMetric({ name: METRICS.cancellations, kind: 'counter', value: 1, attributes: { kind: options.kind } });
}
