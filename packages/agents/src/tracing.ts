import { createOpenTelemetryAdapter } from '@gixcopilot/telemetry';
import type { SpanHandle, TelemetryAdapter } from '@gixcopilot/telemetry';

export const defaultAgentTelemetry: TelemetryAdapter = createOpenTelemetryAdapter({ instrumentationName: '@gixcopilot/agents' });

export interface SpanCorrelation {
  readonly runId: string;
  readonly threadId?: string;
  readonly rootRunId?: string;
  readonly parentRunId?: string;
  readonly tenantId?: string;
}

export function startChildSpan(telemetry: TelemetryAdapter, name: string, parent: SpanHandle | undefined, correlation: SpanCorrelation, attributes: Readonly<Record<string, string | number | boolean | undefined>> = {}): SpanHandle {
  return telemetry.startSpan(name, { parent, correlation, attributes });
}
export function endSpanOk(span: SpanHandle): void { span.end('ok'); }
export function endSpanError(span: SpanHandle, error: unknown): void { span.end('error', error); }
