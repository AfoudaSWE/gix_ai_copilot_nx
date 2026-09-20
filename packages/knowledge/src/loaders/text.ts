import { createKnowledgeDocument } from '../document.js';
import type { KnowledgeDocument } from '../document.js';
import { throwIfAborted, type DocumentLoader, type LoaderContext } from '../loader.js';
import { normalizeText } from '../normalize.js';
import type { KnowledgeSource, TextSourceConfig } from '../source.js';

/** Plain-text loader (Section 16). */
export const textLoader: DocumentLoader<TextSourceConfig> = {
  async *load(
    source: KnowledgeSource<TextSourceConfig>,
    context?: LoaderContext,
  ): AsyncIterable<KnowledgeDocument> {
    throwIfAborted(context?.signal);
    await Promise.resolve(); // keep every loader's first yield microtask-deferred, not just the I/O-bound ones
    yield createKnowledgeDocument({
      sourceId: source.id,
      content: normalizeText(source.config.content),
      metadata: {
        ...(source.name !== undefined ? { title: source.name } : {}),
        mimeType: 'text/plain',
        tenantId: source.tenantId,
        acl: source.acl,
      },
    });
  },
};
