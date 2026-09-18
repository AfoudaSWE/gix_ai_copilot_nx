import { CopilotError } from '@gixcopilot/protocol';
import type { FinishReason, Usage } from '@gixcopilot/protocol';
import type { Executor, ExecutorCompletion, ExecutorContext, ExecutorInput } from '@gixcopilot/core';
import type { ModelReference } from './model-reference.js';
import type { ModelRuntime } from './model-runtime.js';

export interface CreateModelExecutorOptions {
  readonly runtime: ModelRuntime;
  /** Optional if the runtime was configured with defaultProvider/defaultModel. */
  readonly model?: ModelReference;
  readonly temperature?: number;
  readonly maxOutputTokens?: number;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly timeoutMs?: number;
}

/**
 * The seam Section 5's architecture diagram describes: wraps a `ModelRuntime` (Phase 2, in
 * this package) as an `@gixcopilot/core` `Executor` (Phase 1's generic run/execution
 * boundary), so `createRuntime({ executor: createModelExecutor({...}) })` drives a real
 * model exactly the way it already drives `createEchoExecutor()`. Core itself never learns
 * anything about providers, retries, or timeouts - this is the only place that knowledge
 * lives on the core side of the boundary.
 */
export function createModelExecutor(options: CreateModelExecutorOptions): Executor {
  return {
    async *execute(
      input: ExecutorInput,
      context: ExecutorContext,
    ): AsyncGenerator<string, ExecutorCompletion | void, undefined> {
      let usage: Usage | undefined;
      let finishReason: FinishReason | undefined;

      for await (const event of options.runtime.stream({
        model: options.model,
        messages: input.messages,
        temperature: options.temperature,
        maxOutputTokens: options.maxOutputTokens,
        metadata: options.metadata,
        timeoutMs: options.timeoutMs,
        signal: context.signal,
      })) {
        switch (event.type) {
          case 'model.started':
            break;
          case 'content.delta':
            yield event.delta;
            break;
          case 'usage.updated':
            usage = event.usage;
            break;
          case 'model.completed':
            usage = event.usage ?? usage;
            finishReason = event.finishReason;
            return { usage, finishReason };
          case 'model.failed':
            throw new CopilotError(event.error.code, event.error.message, {
              retryable: event.error.retryable,
              metadata: event.error.metadata,
            });
          default: {
            const exhaustive: never = event;
            throw new Error(`Unhandled model stream event: ${JSON.stringify(exhaustive)}`);
          }
        }
      }

      return { usage, finishReason };
    },
  };
}
