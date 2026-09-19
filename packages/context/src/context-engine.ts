import type { ContextRegistry } from './context-registry.js';
import type { CopilotContextItem } from './context-item.js';
import { priorityWeight } from './context-priority.js';
import type { ContextSerializer } from './context-serializer.js';
import { createDefaultContextSerializer } from './context-serializer.js';
import type { TokenEstimator } from './token-estimator.js';
import { createDefaultTokenEstimator } from './token-estimator.js';
import type { ContextCompressor } from './context-compressor.js';
import { createTruncatingCompressor } from './context-compressor.js';
import { formatContextItemBlock, joinContextBlocks } from './context-format.js';
import type {
  ContextDiagnostics,
  ContextExclusion,
  ContextInspection,
  ResolvedContext,
  ResolvedContextItem,
} from './resolved-context.js';

const DEFAULT_MAX_CONTEXT_TOKENS = 8000;
/** Smallest remaining budget the engine will bother compressing an item into (Section 28). */
const MIN_COMPRESSIBLE_BUDGET_TOKENS = 16;

export interface ContextEngineOptions {
  /** Total token budget resolved context may consume. Default 8000 (Section 25). */
  readonly maxContextTokens?: number;
  readonly estimator?: TokenEstimator;
  readonly serializer?: ContextSerializer;
  readonly compressor?: ContextCompressor;
  /**
   * Returns `true` if an item is allowed to reach the model. Defaults to excluding
   * `restricted` items. This is a conservative default, not a security boundary (Section 30,
   * 58) - Phase 7 owns real sensitivity/PII enforcement.
   */
  readonly sensitivityPolicy?: (item: CopilotContextItem) => boolean;
}

/**
 * The central pipeline: Registry -> Collect -> Validate -> Serialize -> Filter ->
 * Deduplicate -> Prioritize -> Budget -> Resolved Context (Section 23). One registry's
 * worth of items in, one `ResolvedContext` out - stateless with respect to the registry, so
 * one engine can safely serve many isolated registries (Section 65).
 */
export interface ContextEngine {
  resolve(registry: ContextRegistry): Promise<ResolvedContext>;
  /** Debug-friendly projection of `resolve()`, for future DevTools (Section 57, 90). */
  inspect(registry: ContextRegistry): Promise<ContextInspection>;
}

function defaultSensitivityPolicy(item: CopilotContextItem): boolean {
  return item.sensitivity !== 'restricted';
}

interface Candidate {
  readonly item: CopilotContextItem;
  text: string;
  estimatedTokens: number;
  truncated: boolean;
  readonly dedupeKey: string;
}

export function createContextEngine(options: ContextEngineOptions = {}): ContextEngine {
  const maxContextTokens = options.maxContextTokens ?? DEFAULT_MAX_CONTEXT_TOKENS;
  const estimator = options.estimator ?? createDefaultTokenEstimator();
  const serializer = options.serializer ?? createDefaultContextSerializer();
  const compressor = options.compressor ?? createTruncatingCompressor(estimator);
  const sensitivityPolicy = options.sensitivityPolicy ?? defaultSensitivityPolicy;

  async function resolve(registry: ContextRegistry): Promise<ResolvedContext> {
    const startedAt = Date.now();
    const allItems = registry.list();
    const exclusions: ContextExclusion[] = [];
    const candidates: Candidate[] = [];

    for (const item of allItems) {
      // No runtime "invalid" check here: `ContextRegistry.register/update/patch` already
      // reject a blank name at admission time, so every item reaching this loop is
      // structurally valid. The `'invalid'` exclusion reason stays part of the type (Section
      // 35) for a future validated-input path (e.g. schema-checked registration) rather than
      // being exercised by dead code today - see Phase_4_Decisions.md.
      if (!item.enabled) {
        exclusions.push({ id: item.id, name: item.name, scope: item.scope, reason: 'disabled' });
        continue;
      }
      if (!sensitivityPolicy(item)) {
        exclusions.push({
          id: item.id,
          name: item.name,
          scope: item.scope,
          reason: 'sensitivity-policy',
        });
        continue;
      }

      try {
        const serialized = serializer.serialize(item.value);
        const text = formatContextItemBlock(item.name, item.scope, item.description, serialized.text);
        candidates.push({
          item,
          text,
          estimatedTokens: estimator.estimate(text),
          truncated: serialized.truncated,
          dedupeKey: serialized.text,
        });
      } catch (error) {
        exclusions.push({
          id: item.id,
          name: item.name,
          scope: item.scope,
          reason: 'serialization-failure',
          detail: error instanceof Error ? error.message : 'Unknown serialization error.',
        });
      }
    }

    // Deduplication (Section 24): identical serialized *values* collapse to the
    // highest-priority (then earliest-registered) candidate; the rest are excluded as
    // 'duplicate'. Comparing the serialized text is a deliberate identity/hash check, not a
    // fuzzy similarity guess.
    const bestByKey = new Map<string, Candidate>();
    for (const candidate of candidates) {
      const existing = bestByKey.get(candidate.dedupeKey);
      if (!existing || priorityWeight(candidate.item.priority) < priorityWeight(existing.item.priority)) {
        bestByKey.set(candidate.dedupeKey, candidate);
      }
    }
    const deduped: Candidate[] = [];
    for (const candidate of candidates) {
      if (bestByKey.get(candidate.dedupeKey) === candidate) {
        deduped.push(candidate);
      } else {
        exclusions.push({
          id: candidate.item.id,
          name: candidate.item.name,
          scope: candidate.item.scope,
          reason: 'duplicate',
        });
      }
    }

    // Prioritize (Section 20, 27): stable sort by explicit priority tier only.
    const prioritized = deduped
      .map((candidate, index) => ({ candidate, index }))
      .sort((a, b) => {
        const byPriority = priorityWeight(a.candidate.item.priority) - priorityWeight(b.candidate.item.priority);
        return byPriority !== 0 ? byPriority : a.index - b.index;
      })
      .map((entry) => entry.candidate);

    // Budget allocation with safe truncation (Section 27, 28): include while budget
    // remains; an item that doesn't fit is compressed toward the remaining budget before
    // being excluded outright.
    const resolvedItems: ResolvedContextItem[] = [];
    let remaining = maxContextTokens;
    for (const candidate of prioritized) {
      if (remaining <= 0) {
        exclusions.push({
          id: candidate.item.id,
          name: candidate.item.name,
          scope: candidate.item.scope,
          reason: 'budget',
        });
        continue;
      }
      if (candidate.estimatedTokens <= remaining) {
        resolvedItems.push(toResolvedItem(candidate));
        remaining -= candidate.estimatedTokens;
        continue;
      }

      // Below this, compressing would only produce a near-useless fragment - exclude
      // outright instead of "including" a scrap of text (Section 28). Only a remaining
      // budget worth compressing into is worth spending the compressor call on.
      if (remaining < MIN_COMPRESSIBLE_BUDGET_TOKENS) {
        exclusions.push({
          id: candidate.item.id,
          name: candidate.item.name,
          scope: candidate.item.scope,
          reason: 'budget',
        });
        continue;
      }

      const compressed = await compressor.compress(
        { text: candidate.text, estimatedTokens: candidate.estimatedTokens },
        remaining,
      );
      if (compressed.estimatedTokens > 0 && compressed.estimatedTokens <= remaining) {
        resolvedItems.push(
          toResolvedItem({ ...candidate, text: compressed.text, estimatedTokens: compressed.estimatedTokens, truncated: true }),
        );
        remaining -= compressed.estimatedTokens;
      } else {
        exclusions.push({
          id: candidate.item.id,
          name: candidate.item.name,
          scope: candidate.item.scope,
          reason: 'budget',
        });
      }
    }

    const content = joinContextBlocks(resolvedItems.map((item) => item.text));
    const diagnostics: ContextDiagnostics = {
      itemsRegistered: allItems.length,
      itemsIncluded: resolvedItems.length,
      itemsExcluded: exclusions.length,
      resolutionMs: Date.now() - startedAt,
    };

    return {
      items: resolvedItems,
      content,
      estimatedTokens: content ? estimator.estimate(content) : 0,
      excluded: exclusions,
      diagnostics,
    };
  }

  async function inspect(registry: ContextRegistry): Promise<ContextInspection> {
    const resolved = await resolve(registry);
    return {
      estimatedTokens: resolved.estimatedTokens,
      included: resolved.items.map((item) => ({
        name: item.name,
        scope: item.scope,
        priority: item.priority,
        estimatedTokens: item.estimatedTokens,
        truncated: item.truncated,
      })),
      excluded: resolved.excluded.map((exclusion) => ({
        name: exclusion.name,
        scope: exclusion.scope,
        reason: exclusion.reason,
      })),
      diagnostics: resolved.diagnostics,
    };
  }

  return { resolve, inspect };
}

function toResolvedItem(candidate: Candidate): ResolvedContextItem {
  return {
    id: candidate.item.id,
    name: candidate.item.name,
    description: candidate.item.description,
    scope: candidate.item.scope,
    priority: candidate.item.priority,
    sensitivity: candidate.item.sensitivity,
    estimatedTokens: candidate.estimatedTokens,
    truncated: candidate.truncated,
    text: candidate.text,
  };
}
