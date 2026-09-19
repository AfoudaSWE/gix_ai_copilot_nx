import { CopilotError } from '@gixcopilot/protocol';
import type { RunId, ToolCallId, ToolResult } from '@gixcopilot/protocol';

interface PendingCall {
  resolve(result: ToolResult): void;
}

export interface AwaitFrontendResultOptions {
  readonly signal: AbortSignal;
  /** Undefined means "wait indefinitely, bounded only by `signal`" - a server may still
   * want a hard default; see `createServer`'s `frontendToolTimeoutMs` option. */
  readonly timeoutMs?: number;
}

/**
 * The server-side half of the frontend tool transport (Section 45-51): correlates a
 * `tool.requested` event sent to the client with the `POST /runs/:runId/tool-results` the
 * client eventually sends back. Deliberately in-memory/process-local, mirroring
 * `RunRegistry`'s own documented limitation (see docs/TECHNICAL_DEBT.md) - a multi-instance
 * deployment needs a shared store, out of scope for Phase 5.
 */
export interface FrontendToolBridge {
  /**
   * Suspends until `submitResult` is called for this (runId, toolCallId), the run's signal
   * aborts (mapped to a CANCELLED ToolResult), or `timeoutMs` elapses with no client
   * response (mapped to FRONTEND_TOOL_UNAVAILABLE, Section 51) - never hangs forever.
   */
  awaitResult(
    runId: RunId,
    toolCallId: ToolCallId,
    toolName: string,
    options: AwaitFrontendResultOptions,
  ): Promise<ToolResult>;
  /** Returns true if a pending call was found and resolved, false for an unknown/already-
   * resolved (runId, toolCallId) - the caller (the HTTP route) maps that to 404/410. */
  submitResult(runId: RunId, toolCallId: ToolCallId, result: ToolResult): boolean;
}

function key(runId: RunId, toolCallId: ToolCallId): string {
  return `${runId}:${toolCallId}`;
}

export function createFrontendToolBridge(): FrontendToolBridge {
  const pending = new Map<string, PendingCall>();

  return {
    awaitResult(runId, toolCallId, toolName, options) {
      const mapKey = key(runId, toolCallId);
      return new Promise<ToolResult>((resolve) => {
        let settled = false;

        function cleanup(): void {
          if (timer !== undefined) clearTimeout(timer);
          options.signal.removeEventListener('abort', onAbort);
          pending.delete(mapKey);
        }
        function settle(result: ToolResult): void {
          if (settled) return;
          settled = true;
          cleanup();
          resolve(result);
        }
        function onAbort(): void {
          settle({ status: 'error', toolCallId, error: CopilotError.cancelled().toPublicJSON() });
        }

        const timer =
          options.timeoutMs !== undefined
            ? setTimeout(() => {
                settle({
                  status: 'error',
                  toolCallId,
                  error: CopilotError.frontendToolUnavailable(toolName).toPublicJSON(),
                });
              }, options.timeoutMs)
            : undefined;

        if (options.signal.aborted) {
          onAbort();
          return;
        }
        options.signal.addEventListener('abort', onAbort, { once: true });
        pending.set(mapKey, { resolve: settle });
      });
    },

    submitResult(runId, toolCallId, result) {
      if (result.toolCallId !== toolCallId) return false;
      const mapKey = key(runId, toolCallId);
      const entry = pending.get(mapKey);
      if (!entry) return false;
      entry.resolve(result);
      return true;
    },
  };
}
