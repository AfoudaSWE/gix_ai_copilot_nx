import type { ContentPart, CopilotEvent, MessageRole } from '@aicopilot/protocol';
import type { CopilotTransport } from './transport.js';
import { createSseTransport } from './sse-transport.js';

export interface ClientMessageInput {
  readonly role: MessageRole;
  readonly content: readonly ContentPart[];
}

export interface RunOptions {
  readonly threadId?: string;
  readonly message: ClientMessageInput;
  /** Cancels the run if aborted, in addition to the `cancel()` method on the returned run. */
  readonly signal?: AbortSignal;
}

export interface ClientRun {
  /** Single-use: drives the underlying transport request forward as it's iterated. */
  readonly events: AsyncIterable<CopilotEvent>;
  /** Idempotent. Ends the client's connection to the server, which cancels the run server-side. */
  cancel(): void;
}

export interface CopilotClientOptions {
  readonly baseUrl: string;
  /** Override for a non-SSE transport (e.g. in tests) - see the CopilotTransport interface. */
  readonly transport?: CopilotTransport;
  readonly fetchImpl?: typeof fetch;
}

export interface CopilotClient {
  run(options: RunOptions): ClientRun;
}

function linkExternalSignal(controller: AbortController, external: AbortSignal | undefined): void {
  if (!external) {
    return;
  }
  if (external.aborted) {
    controller.abort();
    return;
  }
  external.addEventListener('abort', () => controller.abort(), { once: true });
}

/**
 * The framework-independent entry point for @aicopilot/client - no React/Angular
 * dependency (see the react-sdk / angular-sdk skills for how those wrap this).
 */
export function createCopilotClient(options: CopilotClientOptions): CopilotClient {
  const transport =
    options.transport ??
    createSseTransport({ baseUrl: options.baseUrl, fetchImpl: options.fetchImpl });

  return {
    run(runOptions: RunOptions): ClientRun {
      const controller = new AbortController();
      linkExternalSignal(controller, runOptions.signal);

      return {
        events: transport.run({
          threadId: runOptions.threadId,
          message: runOptions.message,
          signal: controller.signal,
        }),
        cancel: () => controller.abort(),
      };
    },
  };
}
