import { importBundle, projectSession } from '@gixcopilot/devtools';
import type { DebugBundle, DevToolsSession } from '@gixcopilot/devtools';
import type { EvalRun } from '@gixcopilot/evals';

export interface ApiConnection {
  /** Base URL of the host app, e.g. '' (same origin through the dev proxy). */
  readonly baseUrl: string;
  /** Sent as a bearer token; never put in a URL (it would leak into logs). */
  readonly token: string;
  /** Optional tenant scope the host's `resolveViewer` honors. */
  readonly tenant?: string;
}

export class DevToolsApiError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'DevToolsApiError';
  }
}

function headers(connection: ApiConnection): Record<string, string> {
  return { authorization: `Bearer ${connection.token}`, ...(connection.tenant ? { 'x-devtools-tenant': connection.tenant } : {}) };
}

/** Reads the viewer-scoped session from the host's DevTools API (Section 24). */
export async function fetchSession(connection: ApiConnection, fetchImpl: typeof fetch = fetch): Promise<DevToolsSession> {
  const response = await fetchImpl(`${connection.baseUrl}/devtools/session`, { headers: headers(connection) });
  if (response.status === 401) throw new DevToolsApiError('The DevTools token was rejected.', 401);
  if (response.status === 404) throw new DevToolsApiError('DevTools is not enabled on this host.', 404);
  if (!response.ok) throw new DevToolsApiError(`DevTools API error ${response.status}.`, response.status);
  return (await response.json()) as DevToolsSession;
}

/** Downloads a sanitized debug bundle from the host (Section 166). */
export async function fetchBundle(connection: ApiConnection, fetchImpl: typeof fetch = fetch): Promise<DebugBundle> {
  const response = await fetchImpl(`${connection.baseUrl}/devtools/export`, { headers: headers(connection) });
  if (!response.ok) throw new DevToolsApiError(`Export failed (${response.status}).`, response.status);
  return importBundle(await response.text());
}

/**
 * Follows the SSE diagnostics stream with `fetch` (EventSource cannot send an Authorization
 * header). Calls `onEvent` per frame; resolves when the stream ends or `signal` aborts.
 */
export async function followStream(connection: ApiConnection, onEvent: () => void, signal: AbortSignal, fetchImpl: typeof fetch = fetch): Promise<void> {
  const response = await fetchImpl(`${connection.baseUrl}/devtools/stream`, { headers: headers(connection), signal });
  if (!response.ok || !response.body) throw new DevToolsApiError(`Stream unavailable (${response.status}).`, response.status);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return;
    buffer += decoder.decode(value, { stream: true });
    let boundary = buffer.indexOf('\n\n');
    while (boundary !== -1) {
      if (buffer.slice(0, boundary).includes('data:')) onEvent();
      buffer = buffer.slice(boundary + 2);
      boundary = buffer.indexOf('\n\n');
    }
  }
}

/** Parses an imported bundle into a session. Import is inert: nothing is executed (Section 167). */
export function sessionFromBundle(text: string): { readonly session: DevToolsSession; readonly bundle: DebugBundle } {
  const bundle = importBundle(text);
  return { bundle, session: projectSession(bundle.snapshot) };
}

/** Accepts the JSON written by `toEvalJson` (or a bare EvalRun). */
export function evalRunFromJson(text: string): EvalRun {
  const parsed = JSON.parse(text) as { format?: string; run?: EvalRun } & Partial<EvalRun>;
  const run = parsed.format === 'gixcopilot.eval.run' ? parsed.run : (parsed as EvalRun);
  if (!run || typeof run !== 'object' || !run.summary || !Array.isArray(run.results)) throw new Error('Not an eval report (expected toEvalJson output).');
  return run;
}
