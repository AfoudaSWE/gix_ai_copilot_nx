import type { KnowledgeDocument } from './document.js';
import type { KnowledgeSource } from './source.js';

export interface LoaderContext {
  readonly signal?: AbortSignal;
}

/**
 * Loads documents from a KnowledgeSource (Section 15). Async iteration so a large source never
 * has to be fully materialized in memory before the first document is available.
 */
export interface DocumentLoader<TConfig = unknown> {
  load(source: KnowledgeSource<TConfig>, context?: LoaderContext): AsyncIterable<KnowledgeDocument>;
}

export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new DOMException('The load was aborted.', 'AbortError');
  }
}
