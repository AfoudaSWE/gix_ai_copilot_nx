import { readFile } from 'node:fs/promises';
import { CopilotError } from '@gixcopilot/protocol';
import { createKnowledgeDocument } from '../document.js';
import type { KnowledgeDocument } from '../document.js';
import { throwIfAborted, type DocumentLoader, type LoaderContext } from '../loader.js';
import { normalizeText } from '../normalize.js';
import type { HtmlSourceConfig, KnowledgeSource } from '../source.js';
import { extractHtmlStructure } from './html-structure.js';

async function readHtml(config: HtmlSourceConfig): Promise<string> {
  if (config.html !== undefined) return config.html;
  if (config.path) return readFile(config.path, 'utf8');
  throw CopilotError.sourceLoadFailed('An HTML source requires either "html" or "path".');
}

/** HTML loader (Section 20) - local/pre-fetched HTML only; see web.ts for remote fetching. */
export const htmlLoader: DocumentLoader<HtmlSourceConfig> = {
  async *load(
    source: KnowledgeSource<HtmlSourceConfig>,
    context?: LoaderContext,
  ): AsyncIterable<KnowledgeDocument> {
    throwIfAborted(context?.signal);
    const html = await readHtml(source.config).catch((error: unknown) => {
      if (CopilotError.isCopilotError(error)) throw error;
      throw CopilotError.sourceLoadFailed(`Failed to read HTML source: ${String(error)}`, {
        sourceId: source.id,
      });
    });

    let structure;
    try {
      structure = extractHtmlStructure(html);
    } catch (error) {
      throw CopilotError.parseFailed(`Failed to parse HTML source: ${String(error)}`, {
        sourceId: source.id,
      });
    }

    throwIfAborted(context?.signal);
    const content = normalizeText(structure.text);
    if (content.length === 0) return;

    yield createKnowledgeDocument({
      sourceId: source.id,
      content,
      metadata: {
        ...(source.name !== undefined || structure.title !== undefined
          ? { title: source.name ?? structure.title }
          : {}),
        mimeType: 'text/html',
        tenantId: source.tenantId,
        acl: source.acl,
      },
    });
  },
};
