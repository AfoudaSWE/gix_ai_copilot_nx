import { CopilotError } from '@gixcopilot/protocol';
import { createKnowledgeDocument } from '../document.js';
import type { KnowledgeDocument } from '../document.js';
import { throwIfAborted, type DocumentLoader, type LoaderContext } from '../loader.js';
import { normalizeText } from '../normalize.js';
import type { DatabaseSourceConfig, KnowledgeSource } from '../source.js';

/**
 * Database knowledge loader (Section 22). `query` is the caller's own already-parameterized
 * data access - this loader never constructs or executes SQL, so unrestricted
 * natural-language-to-SQL access is impossible by construction (Section 22's explicit
 * prohibition).
 */
export function createDatabaseLoader<TRow = unknown>(): DocumentLoader<DatabaseSourceConfig<TRow>> {
  return {
    async *load(
      source: KnowledgeSource<DatabaseSourceConfig<TRow>>,
      context?: LoaderContext,
    ): AsyncIterable<KnowledgeDocument> {
      throwIfAborted(context?.signal);
      let rows: readonly TRow[];
      try {
        rows = await source.config.query();
      } catch (error) {
        throw CopilotError.sourceLoadFailed(`Database query failed: ${String(error)}`, {
          sourceId: source.id,
        });
      }

      throwIfAborted(context?.signal);
      for (const [index, row] of rows.entries()) {
        const doc = source.config.toDocument(row, index);
        const content = normalizeText(doc.content);
        if (content.length === 0) continue;
        yield createKnowledgeDocument({
          sourceId: source.id,
          discriminator: doc.discriminator ?? index,
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
}

/** Default-configured database loader for callers not using a custom row type. */
export const databaseLoader: DocumentLoader<DatabaseSourceConfig> = createDatabaseLoader();
