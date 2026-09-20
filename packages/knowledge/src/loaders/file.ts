import { extname } from 'node:path';
import { readFile } from 'node:fs/promises';
import { createKnowledgeDocument } from '../document.js';
import type { KnowledgeDocument } from '../document.js';
import { throwIfAborted, type DocumentLoader, type LoaderContext } from '../loader.js';
import { normalizeText } from '../normalize.js';
import type { FileSourceConfig, KnowledgeSource } from '../source.js';
import { docxLoader } from './docx.js';
import { htmlLoader } from './html.js';
import { markdownLoader } from './markdown.js';
import { pdfLoader } from './pdf.js';

const EXTENSION_DISPATCH = new Set(['.pdf', '.docx', '.html', '.htm', '.md', '.markdown']);

/** Generic file source (Section 10's `file` type) - dispatches to the matching typed loader by extension. */
export const fileLoader: DocumentLoader<FileSourceConfig> = {
  async *load(
    source: KnowledgeSource<FileSourceConfig>,
    context?: LoaderContext,
  ): AsyncIterable<KnowledgeDocument> {
    throwIfAborted(context?.signal);
    const { path } = source.config;
    const base = {
      id: source.id,
      ...(source.name !== undefined ? { name: source.name } : {}),
      ...(source.tenantId !== undefined ? { tenantId: source.tenantId } : {}),
      ...(source.acl !== undefined ? { acl: source.acl } : {}),
      ...(source.metadata !== undefined ? { metadata: source.metadata } : {}),
    };
    const ext = extname(path).toLowerCase();

    if (!EXTENSION_DISPATCH.has(ext)) {
      const content = await readFile(path, 'utf8');
      yield createKnowledgeDocument({
        sourceId: source.id,
        content: normalizeText(content),
        metadata: {
          ...(source.name !== undefined ? { title: source.name } : {}),
          uri: path,
          mimeType: 'text/plain',
          tenantId: source.tenantId,
          acl: source.acl,
        },
      });
      return;
    }

    if (ext === '.pdf') {
      yield* pdfLoader.load({ ...base, type: 'pdf', config: { path } }, context);
      return;
    }
    if (ext === '.docx') {
      yield* docxLoader.load({ ...base, type: 'docx', config: { path } }, context);
      return;
    }
    if (ext === '.html' || ext === '.htm') {
      yield* htmlLoader.load({ ...base, type: 'html', config: { path } }, context);
      return;
    }
    // .md / .markdown
    const content = await readFile(path, 'utf8');
    yield* markdownLoader.load({ ...base, type: 'markdown', config: { content } }, context);
  },
};
