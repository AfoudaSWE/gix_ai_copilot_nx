import { createKnowledgeDocument } from '../document.js';
import type { KnowledgeDocument } from '../document.js';
import { throwIfAborted, type DocumentLoader, type LoaderContext } from '../loader.js';
import { normalizeText } from '../normalize.js';
import type { KnowledgeSource, TextSourceConfig } from '../source.js';

/** First ATX heading (`# Title`) in a markdown document, used as a title fallback (Section 17). */
export function extractMarkdownTitle(content: string): string | undefined {
  const match = /^#\s+(.+)$/m.exec(content);
  return match?.[1]?.trim();
}

/** Markdown loader (Section 17) - preserves the source text as-is; heading structure is picked up during chunking. */
export const markdownLoader: DocumentLoader<TextSourceConfig> = {
  async *load(
    source: KnowledgeSource<TextSourceConfig>,
    context?: LoaderContext,
  ): AsyncIterable<KnowledgeDocument> {
    throwIfAborted(context?.signal);
    await Promise.resolve(); // keep every loader's first yield microtask-deferred, not just the I/O-bound ones
    const content = normalizeText(source.config.content);
    const title = source.name ?? extractMarkdownTitle(content);
    yield createKnowledgeDocument({
      sourceId: source.id,
      content,
      metadata: {
        ...(title !== undefined ? { title } : {}),
        mimeType: 'text/markdown',
        tenantId: source.tenantId,
        acl: source.acl,
      },
    });
  },
};
