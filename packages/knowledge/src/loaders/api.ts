import { CopilotError } from '@gixcopilot/protocol';
import { createKnowledgeDocument } from '../document.js';
import type { KnowledgeDocument } from '../document.js';
import { throwIfAborted, type DocumentLoader, type LoaderContext } from '../loader.js';
import { normalizeText } from '../normalize.js';
import type { ApiSourceConfig, KnowledgeSource } from '../source.js';

/**
 * API knowledge loader (Section 21) - intentionally distinct from a Phase 8 API *tool*: it only
 * turns an already-fetched response into documents, never performs an action. `request`/
 * `toDocuments` are entirely caller-supplied, so this package owns no HTTP client, base-URL
 * policy, or credentials.
 */
export const apiLoader: DocumentLoader<ApiSourceConfig> = {
  async *load(
    source: KnowledgeSource<ApiSourceConfig>,
    context?: LoaderContext,
  ): AsyncIterable<KnowledgeDocument> {
    throwIfAborted(context?.signal);
    let response: unknown;
    try {
      response = await source.config.request();
    } catch (error) {
      throw CopilotError.sourceLoadFailed(`API request failed: ${String(error)}`, {
        sourceId: source.id,
      });
    }

    throwIfAborted(context?.signal);
    const documents = source.config.toDocuments(response);
    for (const doc of documents) {
      const content = normalizeText(doc.content);
      if (content.length === 0) continue;
      yield createKnowledgeDocument({
        sourceId: source.id,
        discriminator: doc.discriminator,
        content,
        metadata: {
          ...doc.metadata,
          tenantId: source.tenantId,
          acl: doc.metadata?.acl ?? source.acl,
        },
      });
    }
  },
};
