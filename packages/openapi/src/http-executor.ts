import type { HttpMethod } from './types.js';

export class SsrfGuardError extends Error {}

export class MissingPathParameterError extends Error {
  constructor(name: string) {
    super(`Path template references "{${name}}" but no value was provided for it.`);
  }
}

export interface HttpExecutionRequest {
  readonly method: HttpMethod;
  readonly baseUrl: string;
  readonly pathTemplate: string;
  readonly pathParams?: Readonly<Record<string, string>>;
  readonly queryParams?: Readonly<Record<string, string | readonly string[] | undefined>>;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: unknown;
  /** How `body` is encoded. Defaults to `'json'`; `'form'` sends
   * `application/x-www-form-urlencoded` for APIs that expect classic form posts. */
  readonly bodyEncoding?: 'json' | 'form';
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
}

export interface HttpExecutionResult {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: unknown;
}

/** Reusable HTTP execution abstraction (Section 33). */
export interface HttpExecutor {
  execute(request: HttpExecutionRequest): Promise<HttpExecutionResult>;
}

/** Response headers surfaced back into the tool result (Section 31's "do not automatically
 * send all response headers to the model") - everything else (rate-limit internals, server
 * banners, `set-cookie`, vendor-specific tracing headers) is dropped by default. */
const RESPONSE_HEADER_ALLOWLIST = new Set(['content-type', 'content-length', 'date', 'etag', 'cache-control']);

const PATH_PARAM_PATTERN = /\{([^}]+)\}/g;

/**
 * Builds the final request URL deterministically from a base URL, a path template, and
 * validated path/query parameter values only (Section 34) - never from a model-supplied full
 * URL or arbitrary path string. Every path parameter value is `encodeURIComponent`-escaped
 * before substitution, so a value cannot inject `/`, `?`, `#`, or a scheme/host (e.g.
 * `"../../x"` or `"evil.com"`) into the URL structure; query parameters go through
 * `URLSearchParams`, which encodes the same way. As a final defense-in-depth check, the
 * constructed URL's origin is compared against the base URL's origin - if anything upstream
 * ever let an origin-changing value through, this throws instead of sending the request
 * (Section 34/35's SSRF boundary: only `baseUrl`, a developer-configured value, may determine
 * scheme/host/port).
 */
function buildUrl(request: HttpExecutionRequest): URL {
  let base: URL;
  try {
    base = new URL(request.baseUrl);
  } catch {
    throw new SsrfGuardError(`Invalid base URL "${request.baseUrl}".`);
  }
  if (base.protocol !== 'http:' && base.protocol !== 'https:') {
    throw new SsrfGuardError(`Unsupported base URL protocol "${base.protocol}" - only http/https are allowed.`);
  }

  if (base.username || base.password || base.search || base.hash) throw new SsrfGuardError('Base URL must not contain credentials, query, or fragment.');
  if (!request.pathTemplate.startsWith('/') || /[?#\\]/.test(request.pathTemplate) || request.pathTemplate.split('/').some((part) => /^(?:\.|%2e){1,2}$/i.test(part))) {
    throw new SsrfGuardError('Unsafe operation path template.');
  }
  const pathParams = request.pathParams ?? {};
  const substitutedPath = request.pathTemplate.replace(PATH_PARAM_PATTERN, (_match, name: string) => {
    const value = pathParams[name];
    if (value === undefined) throw new MissingPathParameterError(name);
    if (value === '.' || value === '..') throw new SsrfGuardError('Dot segments are not valid path parameter values.');
    return encodeURIComponent(value);
  });

  const basePath = base.pathname.endsWith('/') ? base.pathname.slice(0, -1) : base.pathname;
  const relativePath = substitutedPath.startsWith('/') ? substitutedPath : `/${substitutedPath}`;
  const url = new URL(`${basePath}${relativePath}`, base);

  for (const [name, value] of Object.entries(request.queryParams ?? {})) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value as readonly string[]) url.searchParams.append(name, item);
    } else {
      url.searchParams.set(name, value as string);
    }
  }

  if (url.origin !== base.origin) {
    throw new SsrfGuardError('Constructed request URL origin does not match the configured base URL - refusing to send.');
  }

  return url;
}

function withContentType(headers: Readonly<Record<string, string>> | undefined, hasBody: boolean, encoding: 'json' | 'form'): Record<string, string> {
  const merged: Record<string, string> = { ...headers };
  if (hasBody && !Object.keys(merged).some((name) => name.toLowerCase() === 'content-type')) {
    merged['Content-Type'] = encoding === 'form' ? 'application/x-www-form-urlencoded' : 'application/json';
  }
  return merged;
}

/** Encodes a request body. Form bodies accept a flat object of primitives (arrays repeat the key). */
function encodeBody(body: unknown, encoding: 'json' | 'form'): string | undefined {
  if (body === undefined) return undefined;
  if (encoding === 'json') return JSON.stringify(body);
  if (body === null || typeof body !== 'object' || Array.isArray(body)) throw new Error('A form-encoded body must be an object.');
  const form = new URLSearchParams();
  for (const [name, value] of Object.entries(body as Record<string, unknown>)) {
    if (value === undefined || value === null) continue;
    for (const item of Array.isArray(value) ? (value as unknown[]) : [value]) {
      if (typeof item !== 'string' && typeof item !== 'number' && typeof item !== 'boolean') throw new Error(`Form field "${name}" must be a primitive value.`);
      form.append(name, String(item));
    }
  }
  return form.toString();
}

function combineSignals(signals: readonly (AbortSignal | undefined)[]): { readonly signal: AbortSignal; readonly cleanup: () => void } {
  const controller = new AbortController();
  const defined = signals.filter((candidate): candidate is AbortSignal => candidate !== undefined);
  const alreadyAborted = defined.find((candidate) => candidate.aborted);
  if (alreadyAborted) {
    controller.abort(alreadyAborted.reason);
    return { signal: controller.signal, cleanup: () => {} };
  }

  const attached: { readonly signal: AbortSignal; readonly listener: () => void }[] = [];
  for (const candidate of defined) {
    const listener = () => controller.abort(candidate.reason);
    candidate.addEventListener('abort', listener, { once: true });
    attached.push({ signal: candidate, listener });
  }
  return {
    signal: controller.signal,
    cleanup: () => {
      for (const { signal, listener } of attached) signal.removeEventListener('abort', listener);
    },
  };
}

async function normalizeResponseBody(response: Response, maxBytes: number): Promise<unknown> {
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('json') && !contentType.startsWith('text/')) { await response.body?.cancel(); return undefined; }
  const reader: ReadableStreamDefaultReader<Uint8Array> | undefined = response.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (reader) {
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > maxBytes) { await reader.cancel(); throw new Error('External response exceeds configured byte limit.'); }
        chunks.push(chunk.value);
      }
    } finally { reader.releaseLock(); }
  }
  const text = Buffer.concat(chunks).toString('utf8');
  if (contentType.includes('json')) {
    if (text.length === 0) return undefined;
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new Error('External API returned invalid JSON.');
    }
  }
  if (contentType.startsWith('text/')) return text;
  return undefined;
}

/**
 * The default `HttpExecutor`, built on the platform `fetch`. Never called directly with model
 * input: every field of `HttpExecutionRequest` is expected to already be the output of
 * `input-schema.ts`'s validated Zod parse plus deterministic config (`baseUrl`,
 * `pathTemplate`) - this function's only remaining job is the mechanical HTTP call and SSRF
 * guard, not authorization or validation (both already happened upstream).
 */
export function createFetchHttpExecutor(options: { readonly fetchImpl?: typeof fetch; readonly maxResponseBytes?: number } = {}): HttpExecutor {
  const fetchImpl = options.fetchImpl ?? fetch;
  const maxBytes = options.maxResponseBytes ?? 1_048_576;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new Error('Response byte limit must be a positive integer.');
  return {
    async execute(request: HttpExecutionRequest): Promise<HttpExecutionResult> {
      const url = buildUrl(request);
      const timeoutSignal = request.timeoutMs !== undefined ? AbortSignal.timeout(request.timeoutMs) : undefined;
      const { signal, cleanup } = combineSignals([request.signal, timeoutSignal]);
      try {
        const response = await fetchImpl(url, {
          method: request.method.toUpperCase(),
          headers: withContentType(request.headers, request.body !== undefined, request.bodyEncoding ?? 'json'),
          body: encodeBody(request.body, request.bodyEncoding ?? 'json'),
          signal,
          redirect: 'error',
        });

        const headers: Record<string, string> = {};
        response.headers.forEach((value, name) => {
          if (RESPONSE_HEADER_ALLOWLIST.has(name.toLowerCase())) headers[name] = value;
        });

        return { status: response.status, headers, body: await normalizeResponseBody(response, maxBytes) };
      } finally {
        cleanup();
      }
    },
  };
}
