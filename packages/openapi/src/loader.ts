import { readFile } from 'node:fs/promises';
import { parse as parseYaml } from 'yaml';
import type { OpenAPIDocument, OpenAPISource } from './types.js';

/**
 * Loading is deliberately separate from parsing/validation/generation (Section 11) - a
 * caller can supply its own `OpenAPILoader` (e.g. one that reads from a private artifact
 * store) without this package needing to know about it.
 */
export interface OpenAPILoader {
  load(source: OpenAPISource): Promise<unknown>;
}

/**
 * Remote loading is intentionally the most restricted source variant (Section 9-10): a
 * `{ kind: 'url' }` source is never constructed from model output anywhere in this SDK - it
 * is a value the *developer* configures at registration time. `registerOpenAPI`'s own type
 * only accepts `OpenAPISource`, never a bare string, so a caller cannot accidentally pass
 * model-controlled text straight through into a URL fetch.
 */
export function createOpenAPILoader(options: { readonly fetchImpl?: typeof fetch } = {}): OpenAPILoader {
  const fetchImpl = options.fetchImpl ?? fetch;
  return {
    async load(source: OpenAPISource): Promise<unknown> {
      switch (source.kind) {
        case 'object':
          return source.document;
        case 'file': {
          const text = await readFile(source.path, 'utf-8');
          return parseDocumentText(text);
        }
        case 'url': {
          const url = new URL(source.url);
          if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Invalid specification URL.');
          const response = await fetchImpl(url, { redirect: 'error', signal: AbortSignal.timeout(30_000) });
          if (!response.ok) {
            throw new Error(`Failed to load OpenAPI document: HTTP ${String(response.status)}`);
          }
          const text = await response.text();
          return parseDocumentText(text);
        }
      }
    },
  };
}

function parseDocumentText(text: string): unknown {
  const trimmed = text.trimStart();
  if (trimmed.startsWith('{')) return JSON.parse(text) as unknown;
  return parseYaml(text) as unknown;
}

/** Narrows an already-loaded, already-`$ref`-resolved value into the minimal
 * `OpenAPIDocument` shape this package reads - see `validator.ts` for the actual checks. */
export function asOpenAPIDocument(value: unknown): OpenAPIDocument {
  return value as OpenAPIDocument;
}
