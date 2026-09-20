import { readFile } from 'node:fs/promises';
import { CopilotError } from '@gixcopilot/protocol';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createKnowledgeDocument } from '../document.js';
import type { KnowledgeDocument } from '../document.js';
import { throwIfAborted, type DocumentLoader, type LoaderContext } from '../loader.js';
import { normalizeText } from '../normalize.js';
import type { BinarySourceConfig, KnowledgeSource } from '../source.js';

/**
 * PDF loader (Section 18), built on `pdfjs-dist` - the actively maintained upstream Mozilla
 * project. `pdf-parse` (the originally scaffolded dependency) was tried first, but its bundled
 * pdfjs snapshots (v1.10.100/v2.0.550, last updated ~2020) fail to open *any* PDF on this
 * repository's Node >=22 target - verified against both a hand-built minimal PDF and a
 * pdf-lib-generated one, the latter confirmed independently valid by parsing successfully with
 * `pdfjs-dist` itself (see Phase 9 Issues). Using `pdfjs-dist` directly avoids that stale,
 * unmaintained wrapper entirely.
 */

/** pdfjs-dist's `TextItem` shape isn't re-exported from its public type surface - this covers only the fields joinTextItems reads. */
interface PdfTextItem {
  readonly str: string;
  readonly hasEOL: boolean;
}

function isTextItem(item: object): item is PdfTextItem {
  return typeof (item as Partial<PdfTextItem>).str === 'string';
}

/** pdfjs-dist types the document info dictionary as the near-opaque `Object` - narrow it defensively. */
function extractTitle(info: unknown): string | undefined {
  if (!info || typeof info !== 'object' || !('Title' in info)) return undefined;
  return typeof info.Title === 'string' ? info.Title.trim() || undefined : undefined;
}

async function readPdfBuffer(config: BinarySourceConfig): Promise<Buffer> {
  if (config.buffer) return config.buffer;
  if (config.path) return readFile(config.path);
  throw CopilotError.sourceLoadFailed('A PDF source requires either "path" or "buffer".');
}

/** Joins a page's text items using pdfjs's own `hasEOL` flag rather than a Y-position heuristic. */
function joinTextItems(items: readonly object[]): string {
  let text = '';
  for (const item of items) {
    if (!isTextItem(item)) continue;
    text += item.str;
    if (item.hasEOL) text += '\n';
  }
  return text;
}

/** PDF loader (Section 18) - one KnowledgeDocument per page, so page provenance is exact rather than reconstructed. */
export const pdfLoader: DocumentLoader<BinarySourceConfig> = {
  async *load(
    source: KnowledgeSource<BinarySourceConfig>,
    context?: LoaderContext,
  ): AsyncIterable<KnowledgeDocument> {
    throwIfAborted(context?.signal);
    const buffer = await readPdfBuffer(source.config).catch((error: unknown) => {
      if (CopilotError.isCopilotError(error)) throw error;
      throw CopilotError.sourceLoadFailed(`Failed to read PDF source: ${String(error)}`, {
        sourceId: source.id,
      });
    });

    let numPages: number;
    let title: string | undefined;
    let getPage: (pageNumber: number) => ReturnType<Awaited<ReturnType<typeof getDocument>['promise']>['getPage']>;
    try {
      // pdfjs-dist rejects a Node Buffer at runtime even though it is a Uint8Array subclass -
      // it must be a plain Uint8Array.
      const data = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
      // A harmless "Ensure that the standardFontDataUrl API parameter is provided" warning is
      // expected here for text-only extraction (no glyph rendering happens in this loader) -
      // pointing pdfjs-dist at its bundled standard_fonts/ directory instead produces a
      // *different* warning in this Node runtime (it cannot fetch a file:// URL for the font),
      // so the default (undefined) is left as-is rather than trading one cosmetic warning for
      // another.
      const doc = await getDocument({ data, isEvalSupported: false }).promise;
      numPages = doc.numPages;
      const metadata = await doc.getMetadata().catch(() => null);
      title = extractTitle(metadata?.info);
      getPage = (pageNumber: number) => doc.getPage(pageNumber);
    } catch (error) {
      throw CopilotError.parseFailed(`Failed to parse PDF source: ${String(error)}`, {
        sourceId: source.id,
      });
    }

    for (let pageNumber = 1; pageNumber <= numPages; pageNumber++) {
      throwIfAborted(context?.signal);
      let rawPageText: string;
      try {
        const page = await getPage(pageNumber);
        const textContent = await page.getTextContent();
        rawPageText = joinTextItems(textContent.items);
      } catch (error) {
        throw CopilotError.parseFailed(`Failed to extract text from PDF page ${pageNumber}: ${String(error)}`, {
          sourceId: source.id,
          page: pageNumber,
        });
      }

      const content = normalizeText(rawPageText);
      if (content.length === 0) continue;
      yield createKnowledgeDocument({
        sourceId: source.id,
        discriminator: pageNumber,
        content,
        metadata: {
          ...(title !== undefined || source.name !== undefined ? { title: title ?? source.name } : {}),
          mimeType: 'application/pdf',
          page: pageNumber,
          tenantId: source.tenantId,
          acl: source.acl,
        },
      });
    }
  },
};
