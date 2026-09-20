/** Safe integration timings; never includes arguments, URLs, bodies, or credentials. */
export interface IntegrationTelemetryEvent {
  readonly stage: 'load' | 'generate' | 'register' | 'connect' | 'discover' | 'execute';
  readonly integrationId: string;
  readonly toolName?: string;
  readonly durationMs: number;
  readonly status: 'success' | 'error';
}
export type IntegrationTelemetryObserver = (event: IntegrationTelemetryEvent) => void;
export async function measureIntegration<T>(observer: IntegrationTelemetryObserver | undefined,
  event: Pick<IntegrationTelemetryEvent, 'stage' | 'integrationId' | 'toolName'>,
  work: () => Promise<T>): Promise<T> {
  const started = performance.now();
  let status: IntegrationTelemetryEvent['status'] = 'error';
  try { const value = await work(); status = 'success'; return value; }
  finally { try { observer?.({ ...event, status, durationMs: performance.now() - started }); } catch { /* Telemetry cannot affect execution. */ } }
}
