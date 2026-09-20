import { readFile } from 'node:fs/promises';
import { CopilotError } from '@gixcopilot/protocol';
import { convertToHtml } from 'mammoth';
import { createKnowledgeDocument } from '../document.js';
import type { KnowledgeDocument } from '../document.js';
import { throwIfAborted, type DocumentLoader, type LoaderContext } from '../loader.js';
import { normalizeText } from '../normalize.js';
import type { BinarySourceConfig, KnowledgeSource } from '../source.js';
import { extractHtmlStructure } from './html-structure.js';

async function readDocxBuffer(config: BinarySourceConfig): Promise<Buffer> {
  if (config.buffer) return config.buffer;
  if (config.path) return readFile(config.path);
  throw CopilotError.sourceLoadFailed('A DOCX source requires either "path" or "buffer".');
}

/**
 * DOCX loader (Section 19) - converts to HTML via mammoth, then reuses the HTML structure
 * extractor to preserve headings/paragraphs/tables (Section 20's table serialization applies
 * here too, since mammoth already renders DOCX tables as `<table>`).
 */
export const docxLoader: DocumentLoader<BinarySourceConfig> = {
  async *load(
    source: KnowledgeSource<BinarySourceConfig>,
    context?: LoaderContext,
  ): AsyncIterable<KnowledgeDocument> {
    throwIfAborted(context?.signal);
    const buffer = await readDocxBuffer(source.config).catch((error: unknown) => {
      if (CopilotError.isCopilotError(error)) throw error;
      throw CopilotError.sourceLoadFailed(`Failed to read DOCX source: ${String(error)}`, {
        sourceId: source.id,
      });
    });

    let html: string;
    try {
      html = (await convertToHtml({ buffer })).value;
    } catch (error) {
      throw CopilotError.parseFailed(`Failed to parse DOCX source: ${String(error)}`, {
        sourceId: source.id,
      });
    }

    throwIfAborted(context?.signal);
    const structure = extractHtmlStructure(html);
    const content = normalizeText(structure.text);
    if (content.length === 0) return;

    yield createKnowledgeDocument({
      sourceId: source.id,
      content,
      metadata: {
        ...(source.name !== undefined || structure.title !== undefined
          ? { title: source.name ?? structure.title }
          : {}),
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        tenantId: source.tenantId,
        acl: source.acl,
      },
    });
  },
};
