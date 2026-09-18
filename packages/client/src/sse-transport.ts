import { CopilotError, type CopilotEvent, type PublicCopilotError } from '@aicopilot/protocol';
import type { CopilotTransport, TransportRunRequest } from './transport.js';
import { parseSseStream } from './sse-stream.js';

export interface SseTransportOptions {
  readonly baseUrl: string;
  /** Override for testing, or to supply a non-global fetch implementation. */
  readonly fetchImpl?: typeof fetch;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

async function readErrorBody(response: Response): Promise<PublicCopilotError | undefined> {
  try {
    const body: unknown = await response.json();
    if (typeof body === 'object' && body !== null && 'error' in body) {
      const error: unknown = body.error;
      if (typeof error === 'object' && error !== null) {
        return error as PublicCopilotError;
      }
    }
  } catch {
    // response body wasn't JSON - fall through to a generic transport error.
  }
  return undefined;
}

/**
 * The Phase 1 CopilotTransport implementation, over HTTP POST + Server-Sent Events.
 * WebSocket is explicitly out of scope - see docs/architecture/overview.md.
 */
export function createSseTransport(options: SseTransportOptions): CopilotTransport {
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = options.baseUrl.replace(/\/+$/, '');

  return {
    async *run(request: TransportRunRequest): AsyncGenerator<CopilotEvent, void, undefined> {
      try {
        const response = await fetchImpl(`${baseUrl}/runs`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
          body: JSON.stringify({
            ...(request.threadId !== undefined ? { threadId: request.threadId } : {}),
            ...(request.model !== undefined ? { model: request.model } : {}),
            messages: request.messages,
          }),
          signal: request.signal,
        });

        if (!response.ok) {
          const publicError = await readErrorBody(response);
          if (publicError) {
            throw new CopilotError(publicError.code, publicError.message, {
              retryable: publicError.retryable,
              metadata: publicError.metadata,
            });
          }
          throw CopilotError.transport(
            `Server responded with HTTP ${response.status}`,
            undefined,
            response.status >= 500,
          );
        }

        if (!response.body) {
          throw CopilotError.transport('Server response had no body to stream');
        }

        yield* parseSseStream(response.body);
      } catch (error) {
        if (isAbortError(error) && request.signal?.aborted === true) {
          // Self-initiated cancellation: end the stream cleanly, do not surface an error.
          return;
        }
        if (CopilotError.isCopilotError(error)) {
          throw error;
        }
        throw CopilotError.transport('Failed to stream run events', error);
      }
    },

    async cancel(runId: string): Promise<void> {
      const response = await fetchImpl(`${baseUrl}/runs/${encodeURIComponent(runId)}/cancel`, {
        method: 'POST',
      });
      if (!response.ok && response.status !== 404) {
        throw CopilotError.transport(`Cancel request failed with HTTP ${response.status}`);
      }
    },
  };
}
