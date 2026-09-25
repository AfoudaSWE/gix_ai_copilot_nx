import type { SpanHandle } from '../adapter.js';
import type { Correlation } from '../conventions.js';

/**
 * How correlation and the parent span reach layers that only expose a generic
 * `metadata: Record<string, unknown>` bag (model requests, tool execution contexts,
 * retrieval contexts). Purely additive: a runtime that ignores the key behaves exactly as
 * before; a wrapper that finds it can nest its span correctly.
 */
export const TELEMETRY_METADATA_KEY = '__gixcopilotTelemetry' as const;

export interface TelemetryMetadata {
  readonly correlation?: Correlation;
  readonly parentSpan?: SpanHandle;
}

export function readTelemetryMetadata(metadata: unknown): TelemetryMetadata | undefined {
  if (metadata === null || typeof metadata !== 'object') return undefined;
  const value = (metadata as Record<string, unknown>)[TELEMETRY_METADATA_KEY];
  if (value === null || typeof value !== 'object') return undefined;
  return value;
}

export function withTelemetryMetadata(
  metadata: Readonly<Record<string, unknown>> | undefined,
  telemetry: TelemetryMetadata,
): Readonly<Record<string, unknown>> {
  return { ...metadata, [TELEMETRY_METADATA_KEY]: telemetry };
}

/** Strips the telemetry bag so it never leaks into a recorded/redacted payload. */
export function stripTelemetryMetadata(
  metadata: Readonly<Record<string, unknown>> | undefined,
): Readonly<Record<string, unknown>> | undefined {
  if (!metadata || !(TELEMETRY_METADATA_KEY in metadata)) return metadata;
  const { [TELEMETRY_METADATA_KEY]: _omitted, ...rest } = metadata;
  return rest;
}
