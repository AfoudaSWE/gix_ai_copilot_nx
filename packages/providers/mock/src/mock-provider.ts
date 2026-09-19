import { CopilotError } from '@gixcopilot/protocol';
import type {
  CopilotErrorCode,
  FinishReason,
  PublicCopilotError,
  Usage,
} from '@gixcopilot/protocol';
import type {
  ModelExecutionOptions,
  ModelProvider,
  ModelRequest,
  ModelStreamEvent,
  ModelToolCall,
} from '@gixcopilot/provider';

export interface MockFailure {
  readonly code: CopilotErrorCode;
  readonly message: string;
  readonly retryable?: boolean;
}

export interface MockProviderScenario {
  readonly chunks?: readonly string[];
  /** Artificial delay between chunks - defaults to 0 so tests stay instant/deterministic. */
  readonly delayMsPerChunk?: number;
  readonly usage?: Usage;
  readonly finishReason?: FinishReason;
  readonly failBeforeFirstChunk?: MockFailure;
  /** Fails immediately after yielding this many chunks (1-based). */
  readonly failDuringStream?: MockFailure & { readonly afterChunks: number };
  /**
   * Added in Phase 5 (tools, Section 73): when set, the mock model deterministically
   * requests these tool calls after any `chunks` have been emitted, then completes with
   * `finishReason: 'tool_calls'` (overriding `finishReason` above) instead of `'stop'` - no
   * external model or content-matching is involved, exactly like every other scripted field
   * on this scenario.
   */
  readonly toolCalls?: readonly ModelToolCall[];
}

/**
 * A scenario, or a function of the 1-based attempt number - lets a test express "fails on
 * attempt 1, succeeds on attempt 2" to exercise the model-runtime's retry logic (Section 45).
 */
export type MockProviderScenarioInput =
  MockProviderScenario | ((attempt: number) => MockProviderScenario);

export interface MockProviderOptions {
  readonly id?: string;
  readonly scenario?: MockProviderScenarioInput;
}

function toPublicError(failure: MockFailure): PublicCopilotError {
  return new CopilotError(failure.code, failure.message, {
    retryable: failure.retryable ?? false,
  }).toPublicJSON();
}

/**
 * A tiny wrapper around `signal.aborted`, called instead of reading the property inline
 * repeatedly. `.aborted` is a live getter that changes over time, but TypeScript's control
 * flow narrowing doesn't know that and will otherwise narrow later reads of the same
 * expression to a stale literal after an earlier `if` - routing through a function call
 * avoids that false narrowing.
 */
function isAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

function delay(ms: number, signal: AbortSignal | undefined): Promise<void> {
  if (ms <= 0 || signal?.aborted === true) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

/**
 * A deterministic, non-network ModelProvider (Section 15). Never makes a real API call -
 * this is what the runtime/registry/server/client test suites and the mock model-streaming
 * example are built on, so CI never requires provider credentials.
 */
export function createMockProvider(options: MockProviderOptions = {}): ModelProvider {
  const id = options.id ?? 'mock';
  let attempt = 0;

  return {
    id,
    async *stream(
      _request: ModelRequest,
      execOptions?: ModelExecutionOptions,
    ): AsyncGenerator<ModelStreamEvent, void, undefined> {
      attempt += 1;
      const scenario: MockProviderScenario =
        typeof options.scenario === 'function'
          ? options.scenario(attempt)
          : (options.scenario ?? {});

      yield { type: 'model.started' };
      if (isAborted(execOptions?.signal)) {
        return;
      }

      if (scenario.failBeforeFirstChunk) {
        yield { type: 'model.failed', error: toPublicError(scenario.failBeforeFirstChunk) };
        return;
      }

      let chunkIndex = 0;
      for (const chunk of scenario.chunks ?? []) {
        if (isAborted(execOptions?.signal)) {
          return;
        }
        chunkIndex += 1;
        yield { type: 'content.delta', delta: chunk };

        if (scenario.failDuringStream && chunkIndex === scenario.failDuringStream.afterChunks) {
          yield { type: 'model.failed', error: toPublicError(scenario.failDuringStream) };
          return;
        }

        await delay(scenario.delayMsPerChunk ?? 0, execOptions?.signal);
      }

      if (isAborted(execOptions?.signal)) {
        return;
      }

      if (scenario.usage) {
        yield { type: 'usage.updated', usage: scenario.usage };
      }

      if (scenario.toolCalls && scenario.toolCalls.length > 0) {
        for (const toolCall of scenario.toolCalls) {
          if (isAborted(execOptions?.signal)) {
            return;
          }
          yield { type: 'tool_call.requested', toolCall };
        }
        yield { type: 'model.completed', finishReason: 'tool_calls', usage: scenario.usage };
        return;
      }

      yield {
        type: 'model.completed',
        finishReason: scenario.finishReason ?? 'stop',
        usage: scenario.usage,
      };
    },
  };
}
