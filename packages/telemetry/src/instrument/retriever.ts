import { CopilotError } from '@gixcopilot/protocol';
import type { TelemetryAdapter } from '../adapter.js';
import { ATTR, SPAN_NAMES } from '../conventions.js';
import { diagnostic } from '../diagnostics.js';
import type { RagRetrievalDiagnostic, RetrievalCandidateDiagnostic } from '../diagnostics.js';
import { METRICS } from '../metrics.js';
import { readTelemetryMetadata } from './telemetry-metadata.js';

/** Structural subsets of `@gixcopilot/rag` shapes - duck-typed, never imported. */
export interface RetrievalQueryLike {
  readonly text: string;
  readonly topK?: number;
}

export interface RetrievalContextLike {
  readonly securityContext: { readonly tenant?: { readonly tenantId: string }; readonly metadata?: Readonly<Record<string, unknown>> };
  readonly signal?: AbortSignal;
  /** Additive: a wrapper-only bag the real retriever ignores. */
  readonly telemetry?: Readonly<Record<string, unknown>>;
}

export interface RetrievalResultLike {
  readonly items: readonly {
    readonly citationId: string;
    readonly item: {
      readonly chunk: { readonly id: string; readonly content: string; readonly sourceId?: string; readonly documentId?: string };
      readonly score: number;
      readonly provenance: { readonly sourceId: string; readonly documentId: string; readonly title?: string };
    };
  }[];
  readonly citations: readonly unknown[];
  readonly diagnostics: {
    readonly query: string;
    readonly retrievedCount: number;
    readonly authorizedCount: number;
    readonly excludedCount: number;
    readonly rerankedCount: number;
    readonly includedCount: number;
    readonly exclusions: readonly { readonly chunkId: string; readonly reason: string; readonly detail?: string }[];
  };
}

export interface RetrieverLike {
  retrieve(query: RetrievalQueryLike, context: RetrievalContextLike): Promise<RetrievalResultLike>;
}

export interface KnowledgeMeasurementLike {
  readonly stage: string;
  readonly durationMs: number;
  readonly status: 'success' | 'error';
}

export interface RetrieverTelemetry {
  instrument<T extends RetrieverLike>(retriever: T): T;
  /** Pass as `createRetriever({ observer })` so per-stage (embed/search/rerank) timings land
   * on the next `rag.retrieval` diagnostic and as metrics. */
  readonly observer: (measurement: KnowledgeMeasurementLike) => void;
}

/**
 * Wraps `retrieve()` in a `rag.retrieve` span (Section 20, 43-45) and emits one
 * `rag.retrieval` diagnostic: every candidate the retriever reported (selected chunks with
 * score + citation, excluded chunks with their ACL/threshold reason), counts, stage timings.
 * Chunk excerpts are only captured under payload-capturing modes and pass redaction first.
 */
export function createRetrieverTelemetry(telemetry: TelemetryAdapter, options: { readonly now?: () => number } = {}): RetrieverTelemetry {
  const now = options.now ?? ((): number => Date.now());
  let pendingStages: { stage: string; durationMs: number; status: 'success' | 'error' }[] = [];

  return {
    observer: (measurement) => {
      pendingStages.push({ stage: measurement.stage, durationMs: measurement.durationMs, status: measurement.status });
      telemetry.recordMetric({
        name: `${METRICS.ragLatencyMs}.${measurement.stage}`,
        kind: 'histogram',
        value: measurement.durationMs,
        attributes: { [ATTR.status]: measurement.status },
      });
    },
    instrument<T extends RetrieverLike>(retriever: T): T {
      if (!telemetry.enabled) return retriever;
      const instrumented: RetrieverLike = {
        async retrieve(query, context) {
          const meta = readTelemetryMetadata(context.telemetry) ?? readTelemetryMetadata(context.securityContext.metadata);
          const startedAt = now();
          const retrievalId = globalThis.crypto.randomUUID();
          const correlation = { tenantId: context.securityContext.tenant?.tenantId, ...meta?.correlation };
          const span = telemetry.startSpan(SPAN_NAMES.ragRetrieve, {
            parent: meta?.parentSpan,
            correlation,
            startedAt,
            attributes: { [ATTR.retrievalId]: retrievalId },
          });
          pendingStages = [];
          let result: RetrievalResultLike;
          try {
            result = await retriever.retrieve(query, context);
          } catch (caught) {
            const durationMs = now() - startedAt;
            const error = CopilotError.isCopilotError(caught) ? caught.toPublicJSON() : CopilotError.internal(String(caught)).toPublicJSON();
            span.end('error', caught);
            telemetry.recordEvent(
              diagnostic<RagRetrievalDiagnostic>({
                type: 'rag.retrieval',
                correlation: { ...correlation, traceId: span.traceId, spanId: span.spanId, parentSpanId: span.parentSpanId },
                retrievalId,
                durationMs,
                topK: query.topK,
                retrievedCount: 0,
                authorizedCount: 0,
                excludedCount: 0,
                rerankedCount: 0,
                includedCount: 0,
                citationCount: 0,
                candidates: [],
                stages: pendingStages,
                query: telemetry.redaction?.text(query.text),
                error,
              }),
            );
            telemetry.recordMetric({ name: METRICS.errors, kind: 'counter', value: 1, attributes: { kind: 'rag', code: error.code } });
            throw caught;
          }
          const durationMs = now() - startedAt;
          const redaction = telemetry.redaction;
          const candidates: RetrievalCandidateDiagnostic[] = [
            ...result.items.map((entry) => ({
              chunkId: entry.item.chunk.id,
              sourceId: entry.item.provenance.sourceId,
              documentId: entry.item.provenance.documentId,
              title: entry.item.provenance.title,
              score: entry.item.score,
              selected: true,
              citationId: entry.citationId,
              excerpt: redaction?.text(entry.item.chunk.content.slice(0, 240)),
            })),
            ...result.diagnostics.exclusions.map((exclusion) => ({
              chunkId: exclusion.chunkId,
              selected: false,
              exclusionReason: exclusion.reason,
            })),
          ];
          span.setAttributes({
            [ATTR.latencyMs]: durationMs,
            'copilot.rag.retrieved': result.diagnostics.retrievedCount,
            'copilot.rag.included': result.diagnostics.includedCount,
            'copilot.rag.excluded': result.diagnostics.excludedCount,
            'copilot.rag.citations': result.citations.length,
          });
          span.end('ok');
          telemetry.recordEvent(
            diagnostic<RagRetrievalDiagnostic>({
              type: 'rag.retrieval',
              correlation: { ...correlation, traceId: span.traceId, spanId: span.spanId, parentSpanId: span.parentSpanId },
              retrievalId,
              durationMs,
              topK: query.topK,
              retrievedCount: result.diagnostics.retrievedCount,
              authorizedCount: result.diagnostics.authorizedCount,
              excludedCount: result.diagnostics.excludedCount,
              rerankedCount: result.diagnostics.rerankedCount,
              includedCount: result.diagnostics.includedCount,
              citationCount: result.citations.length,
              candidates,
              stages: pendingStages,
              query: redaction?.text(query.text),
            }),
          );
          telemetry.recordMetric({ name: METRICS.ragRetrievals, kind: 'counter', value: 1, attributes: {} });
          telemetry.recordMetric({ name: METRICS.ragLatencyMs, kind: 'histogram', value: durationMs, attributes: {} });
          telemetry.recordMetric({ name: METRICS.ragCandidates, kind: 'histogram', value: result.diagnostics.retrievedCount, attributes: {} });
          telemetry.recordMetric({ name: METRICS.ragIncluded, kind: 'histogram', value: result.diagnostics.includedCount, attributes: {} });
          telemetry.recordMetric({ name: METRICS.ragCitations, kind: 'histogram', value: result.citations.length, attributes: {} });
          return result;
        },
      };
      return Object.assign(Object.create(Object.getPrototypeOf(retriever) as object) as T, retriever, instrumented);
    },
  };
}
