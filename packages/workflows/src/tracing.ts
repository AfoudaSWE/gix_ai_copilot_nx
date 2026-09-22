import { SpanStatusCode, context, trace } from '@opentelemetry/api';
import type { Context, TimeInput } from '@opentelemetry/api';

/**
 * OpenTelemetry instrumentation (Section 149-152, the observability skill): every workflow
 * run and step gets a span, correctly nested (Section 151's "Workflow Run > Step"), each
 * carrying the run correlation id as a standard attribute. See `@gixcopilot/agents`'
 * `tracing.ts` for why parent/child linking is done via explicit `Context` threading rather
 * than `startActiveSpan`'s implicit ambient propagation - the same reasoning applies here.
 *
 * With no SDK/exporter configured, `trace.getTracer(...)` returns OpenTelemetry's own no-op
 * implementation, so this never degrades the hot path (Section 213-214).
 */
const tracer = trace.getTracer('@gixcopilot/workflows');

export interface WorkflowSpanCorrelation {
  readonly workflowRunId: string;
  readonly workflowId: string;
  readonly tenantId?: string;
}

function correlationAttributes(correlation: WorkflowSpanCorrelation): Record<string, string> {
  const attributes: Record<string, string> = {
    'copilot.run_id': correlation.workflowRunId,
    'copilot.workflow_id': correlation.workflowId,
  };
  if (correlation.tenantId) attributes['copilot.tenant_id'] = correlation.tenantId;
  return attributes;
}

export function rootOtelContext(): Context {
  return context.active();
}

export function startChildSpan(
  name: string,
  parentContext: Context,
  correlation: WorkflowSpanCorrelation,
  attributes: Readonly<Record<string, string | number | boolean | undefined>> = {},
): { readonly span: ReturnType<typeof tracer.startSpan>; readonly context: Context } {
  const spanAttributes: Record<string, string | number | boolean> = { ...correlationAttributes(correlation) };
  for (const [key, value] of Object.entries(attributes)) {
    if (value !== undefined) spanAttributes[key] = value;
  }
  const span = tracer.startSpan(name, { attributes: spanAttributes }, parentContext);
  return { span, context: trace.setSpan(parentContext, span) };
}

/**
 * A span whose start/end are set explicitly to real historical timestamps rather than "now"
 * (Section 125-126, the observability skill's "approval waits are spans with explicit start/
 * end so human-wait time is visible"). A workflow's approval wait genuinely spans a process
 * boundary - `start()` returns while paused, and the real wait happens outside this process's
 * memory entirely, resumed by a later, separate `resume()` call - so this cannot be a normal
 * in-process open/close span. Instead, once the real decision timestamp is known (at resume
 * time), the FULL wait is recorded retroactively using the persisted `ApprovalRequest`
 * timestamps as the span's actual start/end times.
 */
export function recordHistoricalSpan(
  name: string,
  parentContext: Context,
  correlation: WorkflowSpanCorrelation,
  startTime: TimeInput,
  endTime: TimeInput,
  attributes: Readonly<Record<string, string | number | boolean | undefined>> = {},
  ok = true,
): void {
  const spanAttributes: Record<string, string | number | boolean> = { ...correlationAttributes(correlation) };
  for (const [key, value] of Object.entries(attributes)) {
    if (value !== undefined) spanAttributes[key] = value;
  }
  const span = tracer.startSpan(name, { attributes: spanAttributes, startTime }, parentContext);
  span.setStatus({ code: ok ? SpanStatusCode.OK : SpanStatusCode.ERROR });
  span.end(endTime);
}

export function endSpanOk(span: ReturnType<typeof tracer.startSpan>): void {
  span.setStatus({ code: SpanStatusCode.OK });
  span.end();
}

export function endSpanError(span: ReturnType<typeof tracer.startSpan>, error: unknown): void {
  span.recordException(error instanceof Error ? error : new Error(String(error)));
  span.setStatus({ code: SpanStatusCode.ERROR, message: error instanceof Error ? error.message : String(error) });
  span.end();
}
