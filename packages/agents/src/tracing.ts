import { SpanStatusCode, context, trace } from '@opentelemetry/api';
import type { Context, Span } from '@opentelemetry/api';

/**
 * OpenTelemetry instrumentation (Section 149-152, the observability skill): every agent run,
 * model call, tool call, and delegation gets a span, correctly nested (Section 150's "Agent
 * Run > Model Call / Tool Call / Delegation > Child Agent Run"), each carrying the run/thread
 * correlation id as a standard attribute. Parent/child linking is done by EXPLICITLY passing
 * an OTel `Context` down through `AgentRunOptions`/dispatch, rather than relying on
 * `startActiveSpan`'s implicit ambient-context propagation - the agent runtime is a deeply
 * recursive, non-trivially-structured async function, and explicit context threading is both
 * easier to reason about here and matches how `runId`/`securityContext`/budget already flow.
 *
 * With no SDK/exporter configured, `trace.getTracer(...)` returns OpenTelemetry's own no-op
 * implementation - every call below is then a near-zero-cost no-op, so this never degrades the
 * hot path (observability skill's "must not degrade the hot path", Section 213-214).
 */
const tracer = trace.getTracer('@gixcopilot/agents');

export interface SpanCorrelation {
  readonly runId: string;
  readonly threadId?: string;
  readonly rootRunId?: string;
  readonly parentRunId?: string;
  readonly tenantId?: string;
}

function correlationAttributes(correlation: SpanCorrelation): Record<string, string> {
  const attributes: Record<string, string> = { 'copilot.run_id': correlation.runId };
  if (correlation.threadId) attributes['copilot.thread_id'] = correlation.threadId;
  if (correlation.rootRunId) attributes['copilot.root_run_id'] = correlation.rootRunId;
  if (correlation.parentRunId) attributes['copilot.parent_run_id'] = correlation.parentRunId;
  if (correlation.tenantId) attributes['copilot.tenant_id'] = correlation.tenantId;
  return attributes;
}

/** The context a fresh top-level call should nest under - whatever is already active, if
 * anything (e.g. a caller's own outer span), or the root context otherwise. */
export function rootOtelContext(): Context {
  return context.active();
}

/** Starts a span as a child of `parentContext`, returning both the span and the new context a
 * further-nested operation should pass down as ITS OWN parent. Caller is responsible for
 * ending the span (success via `endSpanOk`, failure via `endSpanError`) exactly once. */
export function startChildSpan(
  name: string,
  parentContext: Context,
  correlation: SpanCorrelation,
  attributes: Readonly<Record<string, string | number | boolean | undefined>> = {},
): { readonly span: Span; readonly context: Context } {
  const spanAttributes: Record<string, string | number | boolean> = { ...correlationAttributes(correlation) };
  for (const [key, value] of Object.entries(attributes)) {
    if (value !== undefined) spanAttributes[key] = value;
  }
  const span = tracer.startSpan(name, { attributes: spanAttributes }, parentContext);
  return { span, context: trace.setSpan(parentContext, span) };
}

export function endSpanOk(span: Span): void {
  span.setStatus({ code: SpanStatusCode.OK });
  span.end();
}

export function endSpanError(span: Span, error: unknown): void {
  span.recordException(error instanceof Error ? error : new Error(String(error)));
  span.setStatus({ code: SpanStatusCode.ERROR, message: error instanceof Error ? error.message : String(error) });
  span.end();
}
