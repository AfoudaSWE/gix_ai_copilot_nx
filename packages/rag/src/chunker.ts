import type { KnowledgeDocument } from '@gixcopilot/knowledge';
import { deriveChunkId, hashChunkContent, type KnowledgeChunk } from './chunk.js';

/** Splits a document into retrieval-sized chunks, retaining provenance (Section 30). */
export interface Chunker {
  chunk(document: KnowledgeDocument): Promise<KnowledgeChunk[]>;
}

export interface RecursiveChunkerOptions {
  /** Target maximum characters per chunk. Default: 1000. */
  readonly chunkSize?: number;
  /** Characters of trailing overlap carried into the next chunk. Default: 100. */
  readonly chunkOverlap?: number;
  /** Separator hierarchy, tried in order (Section 31/32) - paragraph, then line, then sentence, then word. */
  readonly separators?: readonly string[];
}

const DEFAULT_CHUNK_SIZE = 1000;
const DEFAULT_CHUNK_OVERLAP = 100;
const DEFAULT_SEPARATORS: readonly string[] = ['\n\n', '\n', '. ', ' '];

function hardSplit(text: string, chunkSize: number, chunkOverlap: number): string[] {
  const chunks: string[] = [];
  const step = Math.max(1, chunkSize - chunkOverlap);
  let start = 0;
  while (start < text.length) {
    chunks.push(text.slice(start, start + chunkSize));
    if (start + chunkSize >= text.length) break;
    start += step;
  }
  return chunks;
}

function packUnits(
  units: readonly string[],
  separator: string,
  chunkSize: number,
  chunkOverlap: number,
): string[] {
  const chunks: string[] = [];
  let current: string[] = [];
  let currentLength = 0;

  for (const unit of units) {
    const additional = current.length === 0 ? unit.length : separator.length + unit.length;
    if (currentLength + additional > chunkSize && current.length > 0) {
      chunks.push(current.join(separator));

      const overlapUnits: string[] = [];
      let overlapLength = 0;
      for (let i = current.length - 1; i >= 0; i--) {
        const candidate = current[i] ?? '';
        const extra = overlapUnits.length === 0 ? candidate.length : separator.length + candidate.length;
        if (overlapLength + extra > chunkOverlap) break;
        overlapUnits.unshift(candidate);
        overlapLength += extra;
      }
      current = overlapUnits;
      currentLength = overlapLength;
    }

    current.push(unit);
    currentLength += current.length === 1 ? unit.length : separator.length + unit.length;
  }

  if (current.length > 0) chunks.push(current.join(separator));
  return chunks;
}

/**
 * Recursive, separator-hierarchy-aware character splitter (Section 31/32) - tries each
 * separator in turn, recursively re-splitting any unit still too large with the remaining
 * separators, then falls back to a hard character split once the separator list is exhausted.
 */
function splitRecursive(
  text: string,
  separators: readonly string[],
  chunkSize: number,
  chunkOverlap: number,
): string[] {
  if (text.length === 0) return [];
  if (text.length <= chunkSize) return [text];

  const [separator, ...rest] = separators;
  if (separator === undefined) {
    return hardSplit(text, chunkSize, chunkOverlap);
  }

  const units = text.split(separator).filter((unit) => unit.length > 0);
  if (units.length <= 1) {
    return splitRecursive(text, rest, chunkSize, chunkOverlap);
  }

  const expandedUnits = units.flatMap((unit) =>
    unit.length > chunkSize ? splitRecursive(unit, rest, chunkSize, chunkOverlap) : [unit],
  );
  return packUnits(expandedUnits, separator, chunkSize, chunkOverlap);
}

/**
 * Deterministic table-row detection so a markdown table isn't blindly cut mid-row (Section 33) -
 * a lightweight heuristic (a run of consecutive `|`-delimited lines), not full table parsing.
 */
function extractTableBlocks(text: string): { blocks: readonly string[]; rest: string } {
  const lines = text.split('\n');
  const blocks: string[] = [];
  let current: string[] = [];
  const restLines: string[] = [];

  const flush = (): void => {
    if (current.length >= 2) {
      blocks.push(current.join('\n'));
      restLines.push(`\u0000TABLE_${blocks.length - 1}\u0000`);
    } else {
      restLines.push(...current);
    }
    current = [];
  };

  for (const line of lines) {
    if (line.trim().startsWith('|') && line.trim().endsWith('|')) {
      current.push(line);
    } else {
      flush();
      restLines.push(line);
    }
  }
  flush();

  return { blocks, rest: restLines.join('\n') };
}

function inheritedChunkMetadata(document: KnowledgeDocument, position: number, content: string) {
  const meta = document.metadata;
  return {
    documentId: document.id,
    sourceId: document.sourceId,
    ...(meta.title !== undefined ? { title: meta.title } : {}),
    ...(meta.uri !== undefined ? { uri: meta.uri } : {}),
    ...(meta.page !== undefined ? { page: meta.page } : {}),
    ...(meta.section !== undefined ? { section: meta.section } : {}),
    ...(meta.heading !== undefined ? { heading: meta.heading } : {}),
    position,
    ...(meta.tenantId !== undefined ? { tenantId: meta.tenantId } : {}),
    ...(meta.acl !== undefined ? { acl: meta.acl } : {}),
    ...(meta.tags !== undefined ? { tags: meta.tags } : {}),
    contentHash: hashChunkContent(content),
  };
}

/**
 * Default chunker (Section 31): recursive character-aware splitting with a table-preserving
 * pass first (Section 33), so a markdown table's rows survive as one deterministic block rather
 * than being cut into unreadable fragments - not full document/table layout understanding.
 */
export function createRecursiveChunker(options: RecursiveChunkerOptions = {}): Chunker {
  const chunkSize = options.chunkSize ?? DEFAULT_CHUNK_SIZE;
  const chunkOverlap = options.chunkOverlap ?? DEFAULT_CHUNK_OVERLAP;
  const separators = options.separators ?? DEFAULT_SEPARATORS;

  return {
    // eslint-disable-next-line @typescript-eslint/require-await -- Chunker.chunk is async to allow future chunkers (e.g. a token-based one needing an async tokenizer) without a breaking signature change
    async chunk(document: KnowledgeDocument): Promise<KnowledgeChunk[]> {
      const { blocks, rest } = extractTableBlocks(document.content);
      const pieces = splitRecursive(rest, separators, chunkSize, chunkOverlap).map((piece) =>
        blocks.length === 0
          ? piece
          : piece.replace(/\u0000TABLE_(\d+)\u0000/g, (_match, index: string) => blocks[Number(index)] ?? ''),
      );

      return pieces
        .map((content) => content.trim())
        .filter((content) => content.length > 0)
        .map((content, position) => ({
          id: deriveChunkId(document.id, position, content),
          documentId: document.id,
          sourceId: document.sourceId,
          content,
          metadata: inheritedChunkMetadata(document, position, content),
        }));
    },
  };
}
