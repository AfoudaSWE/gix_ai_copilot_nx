import { CopilotError } from '@gixcopilot/protocol';
import { createKnowledgeDocument } from '../document.js';
import type { KnowledgeDocument } from '../document.js';
import { throwIfAborted, type DocumentLoader, type LoaderContext } from '../loader.js';
import { normalizeText } from '../normalize.js';
import type { KnowledgeSource, WebSourceConfig } from '../source.js';
import { assertSafeWebUrl, SsrfGuardError } from '../net/ssrf-guard.js';
import { extractHtmlStructure } from './html-structure.js';

const DEFAULT_MAX_BYTES = 5_000_000;

/**
 * Remote web loader (Section 20). Deliberately narrow: no arbitrary model-controlled fetch
 * capability (Section 20's explicit prohibition) - the URL comes from a developer-configured
 * `webSource`, never from model output, and is checked with `assertSafeWebUrl` before fetching.
 */
export const webLoader: DocumentLoader<WebSourceConfig> = {
  async *load(
    source: KnowledgeSource<WebSourceConfig>,
    context?: LoaderContext,
  ): AsyncIterable<KnowledgeDocument> {
    throwIfAborted(context?.signal);
    const maxBytes = source.config.maxBytes ?? DEFAULT_MAX_BYTES;
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw CopilotError.validation('maxBytes must be a positive integer.');
    let url: URL;
    try {
      url = new URL(source.config.url);
    } catch {
      throw CopilotError.sourceLoadFailed(`Invalid URL: "${source.config.url}"`, {
        sourceId: source.id,
      });
    }

    try {
      await assertSafeWebUrl(url);
    } catch (error) {
      if (error instanceof SsrfGuardError) {
        throw CopilotError.sourceLoadFailed(error.message, { sourceId: source.id, url: url.href });
      }
      throw error;
    }

    let response: Response;
    try {
      response = await fetch(url, {
        headers: source.config.headers,
        redirect: 'error',
        signal: context?.signal,
      });
    } catch (error) {
      throw CopilotError.sourceLoadFailed(`Failed to fetch "${url.href}": ${String(error)}`, {
        sourceId: source.id,
      });
    }

    if (!response.ok) {
      throw CopilotError.sourceLoadFailed(
        `Fetching "${url.href}" returned HTTP ${response.status}.`,
        { sourceId: source.id, status: response.status },
      );
    }

    const contentLength = response.headers.get('content-length');
    if (contentLength && Number(contentLength) > maxBytes) {
      throw CopilotError.sourceLoadFailed(
        `Response for "${url.href}" exceeds the ${maxBytes}-byte limit.`,
        { sourceId: source.id },
      );
    }

    // This project's tsconfig has no DOM lib, so `response.body`'s web-streams types are not
    // ambiently available here; read through a minimal local shape instead of an unresolved
    // `ReadableStreamReadResult` reference.
    interface StreamChunk {
      readonly done: boolean;
      readonly value: Uint8Array;
    }
    const parts: Uint8Array[] = [];
    let bytes = 0;
    const reader = response.body?.getReader();
    try {
      if (reader) {
        while (true) {
          throwIfAborted(context?.signal);
          const { done, value } = (await reader.read()) as StreamChunk;
          if (done) break;
          bytes += value.byteLength;
          if (bytes > maxBytes) throw CopilotError.sourceLoadFailed(`Response exceeds the ${maxBytes}-byte limit.`, { sourceId: source.id });
          parts.push(value);
        }
      }
    } finally {
      await reader?.cancel();
      reader?.releaseLock();
    }
    const body = Buffer.concat(parts).toString('utf8');

    throwIfAborted(context?.signal);
    const contentType = response.headers.get('content-type') ?? '';
    const structure: { title?: string; text: string } = contentType.includes('html')
      ? extractHtmlStructure(body)
      : { text: body };
    const content = normalizeText(structure.text);
    if (content.length === 0) return;

    yield createKnowledgeDocument({
      sourceId: source.id,
      content,
      metadata: {
        uri: url.href,
        ...(source.name !== undefined || structure.title !== undefined
          ? { title: source.name ?? structure.title }
          : {}),
        mimeType: contentType || undefined,
        tenantId: source.tenantId,
        acl: source.acl,
      },
    });
  },
};
