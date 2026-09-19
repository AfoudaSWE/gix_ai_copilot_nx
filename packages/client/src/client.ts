import type {
  ContentPart,
  CopilotEvent,
  MessageRole,
  ToolManifestEntry,
  ToolResult,
} from '@gixcopilot/protocol';
import type { CopilotTransport } from './transport.js';
import { createSseTransport } from './sse-transport.js';

export interface ClientMessageInput {
  readonly role: MessageRole;
  readonly content: readonly ContentPart[];
}

/**
 * A provider-neutral model reference, `{ provider, model }` - defined locally rather than
 * imported from `@gixcopilot/provider`, since the client must never depend on that package
 * (a client can talk to a server with no model support at all; `model` here is just an
 * opaque field passed through on the wire - see docs/adr/0006-model-provider-abstraction.md).
 */
export interface ClientModelReference {
  readonly provider: string;
  readonly model: string;
}

export interface RunOptions {
  readonly threadId?: string;
  /** Omit to run against the server's default executor (e.g. the Phase 1 echo executor). */
  readonly model?: ClientModelReference;
  /** The full conversation so far, oldest first. */
  readonly messages: readonly ClientMessageInput[];
  /** Added in Phase 5 - frontend tools registered for this run only (Section 45-46). */
  readonly tools?: readonly ToolManifestEntry[];
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
  /** Added in Phase 5 (Section 50) - reports a frontend tool's outcome back to the server so
   * a suspended Model -> Tool -> Model loop can resume. */
  submitToolResult(runId: string, toolCallId: string, result: ToolResult): Promise<void>;
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
 * The framework-independent entry point for @gixcopilot/client - no React/Angular
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
          model: runOptions.model,
          messages: runOptions.messages,
          tools: runOptions.tools,
          signal: controller.signal,
        }),
        cancel: () => controller.abort(),
      };
    },
    submitToolResult: (runId, toolCallId, result) =>
      transport.submitToolResult(runId, toolCallId, result),
  };
}
