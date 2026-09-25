import { CopilotError } from '@gixcopilot/protocol';
import type { SpanHandle, TelemetryAdapter } from '../adapter.js';
import { ATTR, SPAN_NAMES } from '../conventions.js';
import type { Correlation } from '../conventions.js';
import { diagnostic } from '../diagnostics.js';
import type { MemoryOperationDiagnostic } from '../diagnostics.js';
import { METRICS } from '../metrics.js';

/** Structural subset of `@gixcopilot/memory`'s `MemoryService` - duck-typed, never imported. */
export interface MemoryRecordLike {
  readonly id: string;
  readonly type: string;
  readonly owner: { readonly type: string; readonly id: string };
  readonly value: unknown;
  readonly provenance?: string;
}

export interface MemoryServiceLike {
  save(input: { readonly type: string; readonly value: unknown; readonly provenance?: string }, confirmed?: boolean): Promise<MemoryRecordLike>;
  get(id: string): Promise<MemoryRecordLike | null>;
  search(query?: { readonly text?: string; readonly type?: string; readonly topK?: number }): Promise<readonly { readonly record: MemoryRecordLike }[]>;
  forget(id?: string): Promise<void>;
}

export interface InstrumentMemoryOptions {
  readonly correlation?: Correlation;
  readonly parentSpan?: SpanHandle;
  readonly now?: () => number;
}

/**
 * Wraps a `MemoryService` (Section 46-47) in `memory.read`/`memory.write` spans and emits
 * one `memory.operation` diagnostic per call - owner/type/ids/counts/outcome, and the value
 * only under payload-capturing modes. The service itself already binds owner/tenant from the
 * trusted `SecurityContext`, so a diagnostic can never describe another user's memory.
 */
export function instrumentMemoryService<T extends MemoryServiceLike>(
  service: T,
  telemetry: TelemetryAdapter,
  options: InstrumentMemoryOptions = {},
): T {
  if (!telemetry.enabled) return service;
  const now = options.now ?? ((): number => Date.now());

  async function traced<R>(
    operation: MemoryOperationDiagnostic['operation'],
    spanName: string,
    work: () => Promise<R>,
    describe: (result: R) => Partial<MemoryOperationDiagnostic>,
  ): Promise<R> {
    const startedAt = now();
    const span = telemetry.startSpan(spanName, {
      parent: options.parentSpan,
      correlation: options.correlation,
      startedAt,
      attributes: { [ATTR.memoryOperation]: operation },
    });
    let outcome: MemoryOperationDiagnostic['outcome'] = 'allowed';
    let error: MemoryOperationDiagnostic['error'];
    let described: Partial<MemoryOperationDiagnostic> = {};
    try {
      const result = await work();
      described = describe(result);
      return result;
    } catch (caught) {
      const copilotError = CopilotError.isCopilotError(caught) ? caught : CopilotError.internal(caught instanceof Error ? caught.message : String(caught));
      error = copilotError.toPublicJSON();
      outcome = copilotError.code === 'MEMORY_WRITE_DENIED' || copilotError.code === 'MEMORY_READ_DENIED' ? 'denied' : 'error';
      throw caught;
    } finally {
      const durationMs = now() - startedAt;
      span.setAttributes({ [ATTR.status]: outcome, [ATTR.latencyMs]: durationMs, [ATTR.memoryType]: described.memoryType });
      span.end(outcome === 'allowed' ? 'ok' : 'error', error?.message);
      telemetry.recordEvent(
        diagnostic<MemoryOperationDiagnostic>({
          type: 'memory.operation',
          correlation: { ...options.correlation, traceId: span.traceId, spanId: span.spanId, parentSpanId: span.parentSpanId },
          operation,
          durationMs,
          outcome,
          error,
          ...described,
        }),
      );
      telemetry.recordMetric({ name: METRICS.memoryOperations, kind: 'counter', value: 1, attributes: { [ATTR.memoryOperation]: operation, [ATTR.status]: outcome } });
      telemetry.recordMetric({ name: METRICS.memoryLatencyMs, kind: 'histogram', value: durationMs, attributes: { [ATTR.memoryOperation]: operation } });
    }
  }

  const redaction = telemetry.redaction;
  const instrumented: MemoryServiceLike = {
    save: (input, confirmed) =>
      traced('write', SPAN_NAMES.memoryWrite, () => service.save(input, confirmed), (record) => ({
        memoryType: record.type,
        ownerType: record.owner.type,
        ownerId: record.owner.id,
        recordId: record.id,
        provenance: record.provenance,
        value: redaction?.payload(record.value),
      })),
    get: (id) =>
      traced('read', SPAN_NAMES.memoryRead, () => service.get(id), (record) => ({
        memoryType: record?.type,
        ownerType: record?.owner.type,
        ownerId: record?.owner.id,
        recordId: id,
        resultCount: record ? 1 : 0,
        value: record ? redaction?.payload(record.value) : undefined,
      })),
    search: (query) =>
      traced('search', SPAN_NAMES.memoryRead, () => service.search(query), (results) => ({
        memoryType: query?.type,
        resultCount: results.length,
        ownerType: results[0]?.record.owner.type,
        ownerId: results[0]?.record.owner.id,
      })),
    forget: (id) => traced('delete', SPAN_NAMES.memoryWrite, () => service.forget(id), () => ({ recordId: id })),
  };
  return Object.assign(Object.create(Object.getPrototypeOf(service) as object) as T, service, instrumented);
}
