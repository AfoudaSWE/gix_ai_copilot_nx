import type { AuditSink, Identity, Policy, SecurityContext } from '@gixcopilot/security';
import { randomUUID } from 'node:crypto';
import { evaluatePolicies } from '@gixcopilot/security';
import { CopilotError } from '@gixcopilot/protocol';
import { assignCitationIds, type Citation, type WithCitation } from './citations.js';
import type { EmbeddingProvider } from './embeddings/embedding-provider.js';
import type { Reranker } from './reranker.js';
import { createSimilarityReranker } from './reranker.js';
import type { VectorMetadataFilter, VectorRecord, VectorStore } from './vectorstore.js';
import type { KnowledgeChunk } from './chunk.js';
import { isValidKnowledgeAcl, matchesKnowledgeAcl, validateLimit, validateVector } from './vector-security.js';
import { measureKnowledge, type KnowledgeObserver } from './telemetry.js';

export interface RetrievalQuery {
  readonly text: string;
  readonly topK?: number;
  readonly threshold?: number;
  /** Typed/constrained filters only (Section 53) - never an arbitrary/unsafe filter surface, and never a tenant override. */
  readonly filters?: VectorMetadataFilter;
}

/**
 * Duck-typed like @gixcopilot/context's ContextEngineOptions.dataPolicy - avoids a
 * rag -> security type dependency for just this one shape, matching the established pattern.
 */
export interface RetrievalDataPolicy {
  redactText?(text: string): string;
}

export interface RetrievalContext {
  /** Trusted, server-derived identity/tenant - never accept these fields from model/query input (Section 59/145). */
  readonly securityContext: SecurityContext;
  /** Optional ABAC/business rules evaluated per candidate chunk (Section 64). */
  readonly policies?: readonly Policy[];
  readonly dataPolicy?: RetrievalDataPolicy;
  readonly signal?: AbortSignal;
}

export type RetrievalExclusionReason =
  | 'TENANT_MISMATCH'
  | 'ACL_DENIED'
  | 'PERMISSION_DENIED'
  | 'BELOW_THRESHOLD'
  | 'DATA_POLICY'
  | 'INVALID_CHUNK';

export interface RetrievalExclusion {
  readonly chunkId: string;
  readonly reason: RetrievalExclusionReason;
  readonly detail?: string;
}

export interface RetrievalProvenance {
  readonly sourceId: string;
  readonly documentId: string;
  readonly title?: string;
  readonly uri?: string;
  readonly page?: number;
  readonly section?: string;
}

export interface RetrievalItem {
  readonly chunk: KnowledgeChunk;
  readonly score: number;
  readonly provenance: RetrievalProvenance;
}

export interface RetrievalDiagnostics {
  readonly query: string;
  readonly retrievedCount: number;
  readonly authorizedCount: number;
  readonly excludedCount: number;
  readonly rerankedCount: number;
  readonly includedCount: number;
  readonly exclusions: readonly RetrievalExclusion[];
}

export interface RetrievalResult {
  readonly items: readonly WithCitation[];
  readonly citations: readonly Citation[];
  readonly diagnostics: RetrievalDiagnostics;
}

export interface Retriever {
  retrieve(query: RetrievalQuery, context: RetrievalContext): Promise<RetrievalResult>;
}

export interface CreateRetrieverOptions {
  readonly vectorStore: VectorStore;
  readonly embeddingProvider: EmbeddingProvider;
  readonly reranker?: Reranker;
  readonly defaultTopK?: number;
  readonly observer?: KnowledgeObserver;
  readonly auditSink?: AuditSink;
  /** Source URIs are private by default. Explicitly return a safe public URI to expose one. */
  readonly citationUri?: (record: VectorRecord) => string | undefined;
}

const DEFAULT_TOP_K = 5;
/** How many raw candidates to overfetch relative to topK, to leave enough headroom after ACL/ABAC exclusion (Section 56's caveat: more raw hits isn't the goal, this purely compensates for post-filter loss). */
const OVERFETCH_MULTIPLIER = 4;
const MIN_OVERFETCH = 20;

function isAclSatisfied(record: VectorRecord, identity: Identity | undefined): boolean {
  return matchesKnowledgeAcl(record.acl, accessFor(identity));
}

function accessFor(identity: Identity | undefined) {
  const groups = identity?.attributes?.['groups'];
  return { subject: identity?.subject, roles: identity?.roles, permissions: identity?.permissions,
    groups: Array.isArray(groups) ? groups.filter((group): group is string => typeof group === 'string') : [] };
}

function tenantMatches(record: VectorRecord, securityContext: SecurityContext): boolean {
  if (record.tenantId === undefined) return true;
  return record.tenantId === securityContext.tenant?.tenantId;
}

function isValidRecord(record: VectorRecord): boolean {
  return isValidKnowledgeAcl(record.acl) && typeof record.content === 'string' && record.content.trim().length > 0;
}

function toChunk(record: VectorRecord): KnowledgeChunk {
  const metadata = record.metadata ?? {};
  return {
    id: record.chunkId,
    documentId: record.documentId,
    sourceId: record.sourceId,
    content: record.content,
    metadata: {
      documentId: record.documentId,
      sourceId: record.sourceId,
      title: metadata['title'] as string | undefined,
      uri: metadata['uri'] as string | undefined,
      page: metadata['page'] as number | undefined,
      section: metadata['section'] as string | undefined,
      heading: metadata['heading'] as string | undefined,
      position: (metadata['position'] as number | undefined) ?? 0,
      tenantId: record.tenantId,
      acl: record.acl,
      tags: metadata['tags'] as readonly string[] | undefined,
      contentHash: (metadata['contentHash'] as string | undefined) ?? '',
    },
  };
}

/**
 * Permission-aware retrieval pipeline (Section 52/61/69): embed -> tenant-scoped vector search ->
 * ACL post-filter (defense in depth per Section 63, on top of the tenant-scoped query itself) ->
 * ABAC -> threshold -> data policy -> rerank -> citations. Unauthorized results never reach
 * ranking/reranking/context assembly (the rag skill's core rule) - every excluded candidate is
 * dropped the moment its check fails, with the reason recorded in diagnostics, never merely
 * hidden from the final answer while still having been considered.
 */
export function createRetriever(options: CreateRetrieverOptions): Retriever {
  const { vectorStore, embeddingProvider } = options;
  const reranker = options.reranker ?? createSimilarityReranker();
  const defaultTopK = options.defaultTopK ?? DEFAULT_TOP_K;

  return {
    async retrieve(query: RetrievalQuery, context: RetrievalContext): Promise<RetrievalResult> {
      const topK = query.topK ?? defaultTopK;
      validateLimit(topK);
      context.signal?.throwIfAborted();
      const exclusions: RetrievalExclusion[] = [];

      let embedding: number[];
      try {
        embedding = await measureKnowledge('embed.query', options.observer, () => embeddingProvider.embedQuery(query.text, { signal: context.signal }));
        validateVector(embedding, embeddingProvider.dimensions);
      } catch {
        context.signal?.throwIfAborted();
        throw CopilotError.retrievalFailed('Failed to embed retrieval query.');
      }

      let results;
      try {
        // threshold is deliberately NOT passed to the store: applying it here instead keeps one
        // authoritative place for the decision and lets diagnostics record BELOW_THRESHOLD
        // exclusions accurately regardless of what a given VectorStore implementation does.
        results = await measureKnowledge('vector.search', options.observer, () => vectorStore.search({
          embedding,
          tenantId: context.securityContext.tenant?.tenantId,
          topK: Math.min(10_000, Math.max(topK * OVERFETCH_MULTIPLIER, MIN_OVERFETCH)),
          filters: query.filters,
          access: accessFor(context.securityContext.identity),
          embeddingProvider: embeddingProvider.provider,
          embeddingModel: embeddingProvider.model,
          signal: context.signal,
        }));
      } catch {
        context.signal?.throwIfAborted();
        throw CopilotError.retrievalFailed('Vector search failed.');
      }

      const retrievedCount = results.length;
      const identity = context.securityContext.identity;
      const authorized: { record: VectorRecord; score: number }[] = [];

      for (const result of results) {
        context.signal?.throwIfAborted();
        const { record, score } = result;
        if (!isValidRecord(record) || !Number.isFinite(score) || record.embeddingProvider !== embeddingProvider.provider || record.embeddingModel !== embeddingProvider.model || record.embedding.length !== embeddingProvider.dimensions) {
          exclusions.push({ chunkId: record.chunkId, reason: 'INVALID_CHUNK', detail: 'Malformed ACL metadata.' });
          continue;
        }
        if (!tenantMatches(record, context.securityContext)) {
          exclusions.push({ chunkId: record.chunkId, reason: 'TENANT_MISMATCH' });
          continue;
        }
        if (!isAclSatisfied(record, identity)) {
          exclusions.push({ chunkId: record.chunkId, reason: 'ACL_DENIED' });
          continue;
        }
        if (query.threshold !== undefined && score < query.threshold) {
          exclusions.push({ chunkId: record.chunkId, reason: 'BELOW_THRESHOLD' });
          continue;
        }
        authorized.push({ record, score });
      }

      const authorizedCount = authorized.length;
      const abacPassed: { record: VectorRecord; score: number }[] = [];
      if (context.policies && context.policies.length > 0) {
        for (const candidate of authorized) {
          const decision = await evaluatePolicies(context.policies, {
            identity,
            tenant: context.securityContext.tenant,
            action: 'knowledge.retrieve',
            input: query.text,
            resource: candidate.record,
          });
          if (decision.allowed) {
            abacPassed.push(candidate);
          } else {
            exclusions.push({ chunkId: candidate.record.chunkId, reason: 'PERMISSION_DENIED', detail: decision.reason });
          }
        }
      } else {
        abacPassed.push(...authorized);
      }

      const dataPolicyPassed: { record: VectorRecord; score: number }[] = [];
      for (const candidate of abacPassed) {
        const redact = (text: string): string => context.dataPolicy?.redactText?.(text) ?? text;
        let redacted: string;
        let metadata: Record<string, unknown>;
        try {
          redacted = redact(candidate.record.content);
          metadata = { ...candidate.record.metadata, uri: options.citationUri?.(candidate.record) };
          for (const field of ['title', 'section', 'heading', 'uri']) {
            const value = metadata[field];
            if (typeof value === 'string') metadata[field] = redact(value);
            else delete metadata[field];
          }
        } catch {
          exclusions.push({ chunkId: candidate.record.chunkId, reason: 'DATA_POLICY' });
          continue;
        }
        if (redacted.trim().length === 0) {
          exclusions.push({ chunkId: candidate.record.chunkId, reason: 'DATA_POLICY' });
          continue;
        }
        dataPolicyPassed.push({
          record: { ...candidate.record, content: redacted, metadata },
          score: candidate.score,
        });
      }

      const items: RetrievalItem[] = dataPolicyPassed.map(({ record, score }) => ({
        chunk: toChunk(record),
        score,
        provenance: {
          sourceId: record.sourceId,
          documentId: record.documentId,
          title: record.metadata?.['title'] as string | undefined,
          uri: record.metadata?.['uri'] as string | undefined,
          page: record.metadata?.['page'] as number | undefined,
          section: record.metadata?.['section'] as string | undefined,
        },
      }));

      const reranked = await measureKnowledge('rerank', options.observer, () => reranker.rerank(query.text, items, { signal: context.signal }));
      context.signal?.throwIfAborted();
      // A reranker may order/rescore, but cannot introduce unvetted content or citations.
      const byId = new Map(items.map((item) => [item.chunk.id, item]));
      const seen = new Set<string>();
      const included = reranked.flatMap((ranked) => {
        const item = byId.get(ranked.chunk.id);
        if (!item || seen.has(item.chunk.id)) return [];
        seen.add(item.chunk.id);
        return [item];
      }).slice(0, topK);
      const { items: citedItems, citations } = assignCitationIds(included);

      await options.auditSink?.write({ id: randomUUID(), timestamp: new Date().toISOString(), tenantId: context.securityContext.tenant?.tenantId,
        actor: { kind: 'user', subject: identity?.subject }, action: 'knowledge.retrieve', decision: included.length ? 'allowed' : 'empty',
        metadata: { retrievedCount, includedCount: included.length, excludedCount: exclusions.length } });

      return {
        items: citedItems,
        citations,
        diagnostics: {
          query: '[redacted]',
          retrievedCount,
          authorizedCount,
          excludedCount: exclusions.length,
          rerankedCount: reranked.length,
          includedCount: included.length,
          exclusions,
        },
      };
    },
  };
}
