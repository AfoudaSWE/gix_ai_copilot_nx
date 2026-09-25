import { createOpenTelemetryAdapter } from '@gixcopilot/telemetry';
import type { SpanHandle, TelemetryAdapter } from '@gixcopilot/telemetry';

export const defaultWorkflowTelemetry: TelemetryAdapter = createOpenTelemetryAdapter({ instrumentationName: '@gixcopilot/workflows' });

export interface WorkflowSpanCorrelation {
  readonly workflowRunId: string;
  readonly workflowId: string;
  readonly tenantId?: string;
}

export function startChildSpan(telemetry: TelemetryAdapter, name: string, parent: SpanHandle | undefined, correlation: WorkflowSpanCorrelation, attributes: Readonly<Record<string, string | number | boolean | undefined>> = {}): SpanHandle {
  return telemetry.startSpan(name, { parent, correlation: { runId: correlation.workflowRunId, tenantId: correlation.tenantId }, attributes: { 'copilot.workflow_id': correlation.workflowId, ...attributes } });
}
export function recordHistoricalSpan(telemetry: TelemetryAdapter, name: string, parent: SpanHandle | undefined, correlation: WorkflowSpanCorrelation, startTime: Date, endTime: Date, attributes: Readonly<Record<string, string | number | boolean | undefined>> = {}, ok = true): void {
  const span = telemetry.startSpan(name, { parent, startedAt: startTime.getTime(), correlation: { runId: correlation.workflowRunId, tenantId: correlation.tenantId }, attributes: { 'copilot.workflow_id': correlation.workflowId, ...attributes } });
  span.end(ok ? 'ok' : 'error', undefined, endTime.getTime());
}
export function endSpanOk(span: SpanHandle): void { span.end('ok'); }
export function endSpanError(span: SpanHandle, error: unknown): void { span.end('error', error); }
