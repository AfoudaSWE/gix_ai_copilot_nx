import type { TelemetryAdapter } from './adapter.js';
import type { Correlation } from './conventions.js';
import { diagnostic } from './diagnostics.js';
import type { LogDiagnostic } from './diagnostics.js';

/**
 * Structured, correlated logging through the telemetry port (Section 8, 153). Fields pass
 * through the adapter's redaction policy like every other diagnostic payload, so a log line
 * can never carry a secret the trace would have masked (Section 14, 153).
 */
export function recordLog(
  telemetry: TelemetryAdapter,
  level: LogDiagnostic['level'],
  message: string,
  options: { readonly fields?: Readonly<Record<string, unknown>>; readonly correlation?: Correlation } = {},
): void {
  if (!telemetry.enabled) return;
  const redaction = telemetry.redaction;
  telemetry.recordEvent(
    diagnostic<LogDiagnostic>({
      type: 'log',
      level,
      message: redaction ? (redaction.scrub(message) as string) : message,
      fields: options.fields && redaction ? (redaction.payload(options.fields) as Record<string, unknown> | undefined) : options.fields,
      correlation: options.correlation,
    }),
  );
}
