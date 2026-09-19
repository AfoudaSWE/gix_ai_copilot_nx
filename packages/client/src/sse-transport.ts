import { CopilotError, type CopilotEvent, type PublicCopilotError } from '@gixcopilot/protocol';
import type { ToolResult } from '@gixcopilot/protocol';
import type { CopilotTransport, TransportRunRequest } from './transport.js';
import { parseSseStream } from './sse-stream.js';

export interface SseTransportOptions {
  readonly baseUrl: string;
  /** Override for testing, or to supply a non-global fetch implementation. */
  readonly fetchImpl?: typeof fetch;
  /**
   * Added in Phase 7 - extra headers merged into every request (e.g. `Authorization`), so an
   * application's `AuthenticationAdapter` on the server has something trusted to authenticate
   * (Section 13-14). Never a place to put a role/identity claim directly - the server is what
   * turns this into a trusted `Identity`, this is only how the credential itself gets there.
   */
  readonly getHeaders?: () => Record<string, string> | Promise<Record<string, string>>;
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

  async function extraHeaders(): Promise<Record<string, string>> {
    return (await options.getHeaders?.()) ?? {};
  }

  return {
    async *run(request: TransportRunRequest): AsyncGenerator<CopilotEvent, void, undefined> {
      try {
        const response = await fetchImpl(`${baseUrl}/runs`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'text/event-stream',
            ...(await extraHeaders()),
          },
          body: JSON.stringify({
            ...(request.threadId !== undefined ? { threadId: request.threadId } : {}),
            ...(request.model !== undefined ? { model: request.model } : {}),
            messages: request.messages,
            ...(request.action ? { action: request.action } : {}),
            ...(request.tools !== undefined && request.tools.length > 0
              ? { tools: request.tools }
              : {}),
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
        headers: await extraHeaders(),
      });
      if (!response.ok && response.status !== 404) {
        throw CopilotError.transport(`Cancel request failed with HTTP ${response.status}`);
      }
    },

    async submitToolResult(runId: string, toolCallId: string, result: ToolResult): Promise<void> {
      const response = await fetchImpl(
        `${baseUrl}/runs/${encodeURIComponent(runId)}/tool-results`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(await extraHeaders()) },
          body: JSON.stringify({ toolCallId, result }),
        },
      );
      if (!response.ok) {
        throw CopilotError.transport(
          `Submitting the frontend tool result failed with HTTP ${response.status}`,
        );
      }
    },

    async decideApproval(
      approvalId: string,
      decision: 'approve' | 'reject',
      comment?: string,
    ): Promise<void> {
      const response = await fetchImpl(
        `${baseUrl}/approvals/${encodeURIComponent(approvalId)}/${decision}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(await extraHeaders()) },
          body: JSON.stringify(comment !== undefined ? { comment } : {}),
        },
      );
      if (!response.ok) {
        const publicError = await readErrorBody(response);
        if (publicError) {
          throw new CopilotError(publicError.code, publicError.message, {
            retryable: publicError.retryable,
            metadata: publicError.metadata,
          });
        }
        throw CopilotError.transport(`Approval decision failed with HTTP ${response.status}`);
      }
    },
  };
}
