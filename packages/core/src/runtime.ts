import {
  CopilotError,
  PROTOCOL_VERSION,
  createEmptyUsage,
  createEventId,
  createMessageId,
  createRunId,
  createThreadId,
} from '@gixcopilot/protocol';
import type {
  ContentPart,
  CopilotEvent,
  CopilotEventBase,
  MessageRole,
  RunId,
  ThreadId,
  ToolLifecycleEvent,
} from '@gixcopilot/protocol';
import { cancellable } from './cancellable-iteration.js';
import { RunLifecycle } from './lifecycle.js';
import { EventSequencer } from './sequencer.js';
import type { Executor, ExecutorCompletion } from './executor.js';

export interface RunMessageInput {
  readonly role: MessageRole;
  readonly content: readonly ContentPart[];
}

export interface RunOptions {
  readonly threadId?: ThreadId;
  /**
   * The full conversation so far, oldest first. Renamed/pluralized in Phase 2 (was a single
   * `message`) so multi-turn history can reach a model executor - see
   * docs/adr/0006-model-provider-abstraction.md.
   */
  readonly messages: readonly RunMessageInput[];
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

        // Populated synchronously by ExecutorContext.onToolEvent while the executor's own
        // async function runs during an `await deltaIterator.next()` below (Phase 5) - see
        // executor.ts's doc comment. Drained into real tool.* events on the generator's own
        // turn, in the order they were reported.
        const pendingToolEvents: ToolLifecycleEvent[] = [];

        try {
          yield {
            ...envelope(),
            type: 'message.started',
            messageId: assistantMessageId,
            role: 'assistant',
          };

          const executorInput = { threadId, messages: runOptions.messages };
          const executorContext = {
            runId,
            signal: abortController.signal,
            onToolEvent: (event: ToolLifecycleEvent) => {
              pendingToolEvents.push(event);
            },
          };

          // Driven manually (not `for await`) so the executor's own return value
          // (ExecutorCompletion - usage/finishReason) is captured once it finishes, rather
          // than discarded the way a plain `for await` loop would discard it.
          const deltaIterator = cancellable(
            executor.execute(executorInput, executorContext),
            abortController.signal,
          );
          let completion: ExecutorCompletion | undefined;
          while (true) {
            const step = await deltaIterator.next();

            while (pendingToolEvents.length > 0) {
              const toolEvent = pendingToolEvents.shift();
              if (toolEvent) {
                yield toCopilotToolEvent(envelope(), toolEvent);
              }
            }

            if (step.done) {
              completion = step.value ?? undefined;
              break;
            }
            // An empty delta carries no information for a client - it is also how a Phase 5
            // tool-calling Executor forces this loop to drain `pendingToolEvents` and flush
            // them to the wire before a blocking await (e.g. a frontend tool's round trip;
            // see @gixcopilot/server's tool-calling-executor.ts) without ever needing to
            // widen this generic Executor's yield type. Suppressing it here keeps that an
            // internal implementation detail, invisible to protocol consumers.
            if (step.value.length === 0) {
              continue;
            }
            aggregatedText += step.value;
            yield {
              ...envelope(),
              type: 'message.delta',
              messageId: assistantMessageId,
              delta: step.value,
            };
          }

          if (abortController.signal.aborted) {
            lifecycle.transitionTo('cancelled');
            yield { ...envelope(), type: 'run.cancelled' };
            return;
          }

          const content: readonly ContentPart[] = [{ type: 'text', text: aggregatedText }];
          yield { ...envelope(), type: 'message.end', messageId: assistantMessageId, content };

          lifecycle.transitionTo('completed');
          yield {
            ...envelope(),
            type: 'run.completed',
            usage: completion?.usage ?? createEmptyUsage(),
            ...(completion?.finishReason !== undefined
              ? { finishReason: completion.finishReason }
              : {}),
          };
        } catch (error) {
          // Drain any tool events reported just before the throw (e.g. a 'requested'
          // notification for the call whose execution then pushed the executor past its
          // iteration limit) - otherwise they would be silently lost, since the executor
          // rejected instead of resolving its next `step` (see the drain point above, which
          // only runs after a successful `.next()`).
          while (pendingToolEvents.length > 0) {
            const toolEvent = pendingToolEvents.shift();
            if (toolEvent) {
              yield toCopilotToolEvent(envelope(), toolEvent);
            }
          }

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

function toCopilotToolEvent(base: CopilotEventBase, event: ToolLifecycleEvent): CopilotEvent {
  switch (event.phase) {
    case 'requested':
      return {
        ...base,
        type: 'tool.requested',
        toolCallId: event.toolCallId,
        name: event.name,
        arguments: event.arguments,
        source: event.source,
      };
    case 'started':
      return { ...base, type: 'tool.started', toolCallId: event.toolCallId, name: event.name };
    case 'completed':
      return {
        ...base,
        type: 'tool.completed',
        toolCallId: event.toolCallId,
        name: event.name,
        result: event.result,
      };
    case 'failed':
      return {
        ...base,
        type: 'tool.failed',
        toolCallId: event.toolCallId,
        name: event.name,
        error: event.error,
      };
    default: {
      const exhaustive: never = event;
      throw new Error(`Unhandled tool lifecycle phase: ${JSON.stringify(exhaustive)}`);
    }
  }
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
