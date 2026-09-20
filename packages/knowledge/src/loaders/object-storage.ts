import { CopilotError } from '@gixcopilot/protocol';
import { createKnowledgeDocument } from '../document.js';
import type { KnowledgeDocument } from '../document.js';
import { throwIfAborted, type DocumentLoader, type LoaderContext } from '../loader.js';
import { normalizeText } from '../normalize.js';
import type { KnowledgeSource, ObjectStorageSourceConfig } from '../source.js';

/** Object-storage loader (Section 23) - works against any ObjectStorageClient, no cloud SDK dependency. */
export const objectStorageLoader: DocumentLoader<ObjectStorageSourceConfig> = {
  async *load(
    source: KnowledgeSource<ObjectStorageSourceConfig>,
    context?: LoaderContext,
  ): AsyncIterable<KnowledgeDocument> {
    throwIfAborted(context?.signal);
    const { client } = source.config;
    let keys = source.config.keys;
    if (!keys) {
      try {
        keys = await client.list(source.config.prefix);
      } catch (error) {
        throw CopilotError.sourceLoadFailed(`Failed to list object storage keys: ${String(error)}`, {
          sourceId: source.id,
        });
      }
    }

    for (const key of keys) {
      throwIfAborted(context?.signal);
      let object;
      try {
        object = await client.get(key);
      } catch (error) {
        throw CopilotError.sourceLoadFailed(`Failed to read object "${key}": ${String(error)}`, {
          sourceId: source.id,
          key,
        });
      }
      const content = normalizeText(object.content);
      if (content.length === 0) continue;
      yield createKnowledgeDocument({
        sourceId: source.id,
        discriminator: key,
        content,
        metadata: {
          uri: key,
          ...object.metadata,
          tenantId: source.tenantId,
          acl: object.metadata?.acl ?? source.acl,
        },
      });
    }
  },
};
