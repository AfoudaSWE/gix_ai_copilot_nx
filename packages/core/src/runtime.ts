import {
  CopilotError,
  PROTOCOL_VERSION,
  createEmptyUsage,
  createEventId,
  createMessageId,
  createRunId,
  createThreadId,
} from '@aicopilot/protocol';
import type {
  ContentPart,
  CopilotEvent,
  CopilotEventBase,
  MessageRole,
  RunId,
  ThreadId,
} from '@aicopilot/protocol';
import { cancellable } from './cancellable-iteration.js';
import { RunLifecycle } from './lifecycle.js';
import { EventSequencer } from './sequencer.js';
import type { Executor } from './executor.js';

export interface RunMessageInput {
  readonly role: MessageRole;
  readonly content: readonly ContentPart[];
}

export interface RunOptions {
  readonly threadId?: ThreadId;
  readonly message: RunMessageInput;
  /** Cancels the run if aborted, in addition to the `cancel()` method on the returned run. */
  readonly signal?: AbortSignal;
}

export interface RuntimeRun {
  readonly runId: RunId;
  readonly threadId: ThreadId;
  /**
   * Single-use, single-consumer: iterating it drives the run forward. Iterating it a
   * second time throws, rather than silently re-running or replaying - this runtime does
   * not multicast a run's events to multiple subscribers (see the core package README's
   * "Non-responsibilities").
   */
  readonly events: AsyncIterable<CopilotEvent>;
  /** Idempotent - safe to call multiple times, and safe to call after the run has already finished. */
  cancel(): void;
}

export interface CreateRuntimeOptions {
  readonly executor: Executor;
}

export interface Runtime {
  run(options: RunOptions): RuntimeRun;
}

export function createRuntime(options: CreateRuntimeOptions): Runtime {
  const { executor } = options;

  return {
    run(runOptions: RunOptions): RuntimeRun {
      const runId = createRunId();
      const threadId = runOptions.threadId ?? createThreadId();
      const abortController = new AbortController();
      linkExternalSignal(abortController, runOptions.signal);

      const lifecycle = new RunLifecycle();
      const sequencer = new EventSequencer();
      let hasStartedIteration = false;

      function envelope(): CopilotEventBase {
        return {
          id: createEventId(),
          runId,
          threadId,
          sequence: sequencer.next(),
          timestamp: new Date().toISOString(),
          protocolVersion: PROTOCOL_VERSION,
        };
      }

      async function* generate(): AsyncGenerator<CopilotEvent, void, undefined> {
        if (abortController.signal.aborted) {
          lifecycle.transitionTo('cancelled');
          yield { ...envelope(), type: 'run.cancelled' };
          return;
        }

        lifecycle.transitionTo('running');
        yield { ...envelope(), type: 'run.started' };

        const assistantMessageId = createMessageId();
        let aggregatedText = '';

        try {
          yield {
            ...envelope(),
            type: 'message.started',
            messageId: assistantMessageId,
            role: 'assistant',
          };

          const executorInput = { threadId, message: runOptions.message };
          const executorContext = { runId, signal: abortController.signal };

          for await (const delta of cancellable(
            executor.execute(executorInput, executorContext),
            abortController.signal,
          )) {
            aggregatedText += delta;
            yield { ...envelope(), type: 'message.delta', messageId: assistantMessageId, delta };
          }

          if (abortController.signal.aborted) {
            lifecycle.transitionTo('cancelled');
            yield { ...envelope(), type: 'run.cancelled' };
            return;
          }

          const content: readonly ContentPart[] = [{ type: 'text', text: aggregatedText }];
          yield { ...envelope(), type: 'message.end', messageId: assistantMessageId, content };

          lifecycle.transitionTo('completed');
          yield { ...envelope(), type: 'run.completed', usage: createEmptyUsage() };
        } catch (error) {
          if (abortController.signal.aborted) {
            lifecycle.transitionTo('cancelled');
            yield { ...envelope(), type: 'run.cancelled' };
            return;
          }

          const copilotError = toCopilotError(error);
          lifecycle.transitionTo('failed');
          yield { ...envelope(), type: 'run.failed', error: copilotError.toPublicJSON() };
        }
      }

      function getIterator(): AsyncGenerator<CopilotEvent, void, undefined> {
        if (hasStartedIteration) {
          throw CopilotError.protocol(
            'RuntimeRun.events is single-use and was already iterated once.',
          );
        }
        hasStartedIteration = true;
        return generate();
      }

      return {
        runId,
        threadId,
        events: { [Symbol.asyncIterator]: getIterator },
        cancel: () => abortController.abort(),
      };
    },
  };
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

function toCopilotError(error: unknown): CopilotError {
  if (CopilotError.isCopilotError(error)) {
    return error;
  }
  if (error instanceof Error) {
    return CopilotError.internal(error.message, error);
  }
  return CopilotError.internal('Unknown executor error', error);
}
