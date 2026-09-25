import type { TelemetryAdapter } from '../adapter.js';
import { ATTR, SPAN_NAMES } from '../conventions.js';
import type { Correlation } from '../conventions.js';
import { diagnostic } from '../diagnostics.js';
import type { ContextResolvedDiagnostic, ContextScopeContribution } from '../diagnostics.js';
import { METRICS } from '../metrics.js';
import type { SpanHandle } from '../adapter.js';

/** Structural subsets of `@gixcopilot/context` shapes - duck-typed, never imported. */
export interface ResolvedContextLike {
  readonly items: readonly {
    readonly id: string;
    readonly name: string;
    readonly scope: string;
    readonly priority: string;
    readonly sensitivity: string;
    readonly estimatedTokens: number;
    readonly truncated: boolean;
    readonly text: string;
    readonly metadata?: Readonly<Record<string, unknown>>;
  }[];
  readonly content: string;
  readonly estimatedTokens: number;
  readonly excluded: readonly { readonly id: string; readonly name: string; readonly scope: string; readonly reason: string; readonly detail?: string }[];
  readonly diagnostics: { readonly itemsRegistered: number; readonly itemsIncluded: number; readonly itemsExcluded: number; readonly resolutionMs: number };
}

export interface ContextRegistryLike {
  /** Source attribution (`metadata.contextSource`, e.g. `'knowledge'`/`'memory'`) is read from
   * the registered items so a Context inspector can attribute tokens to RAG/memory. */
  list?(options?: { readonly enabledOnly?: boolean }): readonly { readonly id: string; readonly metadata?: Readonly<Record<string, unknown>> }[];
}

export interface ContextEngineLike {
  resolve(registry: ContextRegistryLike): Promise<ResolvedContextLike>;
}

export interface InstrumentContextEngineOptions {
  /** The engine's configured `maxContextTokens` - not exposed by `ResolvedContext`, so the
   * host passes it here to make budget/used/remaining visible (Section 32). */
  readonly maxContextTokens?: number;
  readonly now?: () => number;
}

/** Correlation the caller threads in per resolution (a context engine resolves for many runs). */
export interface ContextResolveTelemetry {
  readonly correlation?: Correlation;
  readonly parentSpan?: SpanHandle;
}

export interface InstrumentedContextEngine<T extends ContextEngineLike> {
  readonly engine: T;
  /** Same as `engine.resolve` but with explicit per-call correlation. */
  resolve(registry: ContextRegistryLike, telemetry?: ContextResolveTelemetry): Promise<ResolvedContextLike>;
}

/**
 * Wraps `resolve()` in a `context.resolve` span (Section 31-34) and emits one
 * `context.resolved` diagnostic: per-scope token contribution, budget/used/remaining, every
 * included item (its text only under payload-capturing modes) and every exclusion with its
 * reason - exactly what the engine itself decided, never a re-computation.
 */
export function instrumentContextEngine<T extends ContextEngineLike>(
  engine: T,
  telemetry: TelemetryAdapter,
  options: InstrumentContextEngineOptions = {},
): InstrumentedContextEngine<T> {
  const now = options.now ?? ((): number => Date.now());
  const budget = options.maxContextTokens ?? 8_000;

  async function resolve(registry: ContextRegistryLike, telemetryContext?: ContextResolveTelemetry): Promise<ResolvedContextLike> {
    if (!telemetry.enabled) return engine.resolve(registry);
    const startedAt = now();
    const span = telemetry.startSpan(SPAN_NAMES.contextResolve, {
      parent: telemetryContext?.parentSpan,
      correlation: telemetryContext?.correlation,
      startedAt,
    });
    let resolved: ResolvedContextLike;
    try {
      resolved = await engine.resolve(registry);
    } catch (error) {
      span.end('error', error);
      throw error;
    }
    const sources = new Map<string, string | undefined>();
    for (const item of registry.list?.({ enabledOnly: false }) ?? []) {
      const source = item.metadata?.['contextSource'];
      sources.set(item.id, typeof source === 'string' ? source : undefined);
    }
    const byScopeMap = new Map<string, ContextScopeContribution>();
    let usedTokens = 0;
    for (const item of resolved.items) {
      usedTokens += item.estimatedTokens;
      const existing = byScopeMap.get(item.scope) ?? { scope: item.scope, items: 0, estimatedTokens: 0 };
      byScopeMap.set(item.scope, { scope: item.scope, items: existing.items + 1, estimatedTokens: existing.estimatedTokens + item.estimatedTokens });
    }
    const redaction = telemetry.redaction;
    span.setAttributes({
      [ATTR.latencyMs]: now() - startedAt,
      'copilot.context.items_included': resolved.diagnostics.itemsIncluded,
      'copilot.context.items_excluded': resolved.diagnostics.itemsExcluded,
      'copilot.context.tokens_used': usedTokens,
      'copilot.context.tokens_budget': budget,
    });
    span.end('ok');
    telemetry.recordEvent(
      diagnostic<ContextResolvedDiagnostic>({
        type: 'context.resolved',
        correlation: { ...telemetryContext?.correlation, traceId: span.traceId, spanId: span.spanId, parentSpanId: span.parentSpanId },
        budgetTokens: budget,
        usedTokens,
        remainingTokens: Math.max(0, budget - usedTokens),
        byScope: [...byScopeMap.values()],
        included: resolved.items.map((item) => ({
          id: item.id,
          name: item.name,
          scope: item.scope,
          priority: item.priority,
          sensitivity: item.sensitivity,
          estimatedTokens: item.estimatedTokens,
          truncated: item.truncated,
          contextSource: sources.get(item.id) ?? (typeof item.metadata?.['contextSource'] === 'string' ? item.metadata['contextSource'] : undefined),
          text: item.sensitivity === 'restricted' || item.sensitivity === 'sensitive' ? undefined : redaction?.text(item.text),
        })),
        excluded: resolved.excluded.map((exclusion) => ({
          id: exclusion.id,
          name: exclusion.name,
          scope: exclusion.scope,
          reason: exclusion.reason,
          detail: redaction?.text(exclusion.detail),
        })),
        resolutionMs: resolved.diagnostics.resolutionMs,
      }),
    );
    telemetry.recordMetric({ name: METRICS.contextResolutions, kind: 'counter', value: 1, attributes: {} });
    telemetry.recordMetric({ name: METRICS.contextTokens, kind: 'histogram', value: usedTokens, attributes: {} });
    return resolved;
  }

  return { engine, resolve };
}
