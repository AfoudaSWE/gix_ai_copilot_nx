import { CopilotError } from '@gixcopilot/protocol';
import type { FinishReason, Usage } from '@gixcopilot/protocol';
import type { ModelMessage } from './model-message.js';
import type { ModelReference } from './model-reference.js';
import type { ModelRequest } from './model-request.js';
import type { ModelProvider } from './model-provider.js';
import type { ModelStreamEvent } from './model-stream-event.js';
import { createModelProviderRegistry, type ModelProviderRegistry } from './registry.js';
import { computeBackoffDelayMs, sleep, DEFAULT_RETRY_POLICY, type RetryPolicy } from './retry.js';
import type { ModelLatency } from './latency.js';
import type { ModelRuntimeTelemetryListener } from './telemetry.js';

export interface ModelExecutionRequest {
  /** Optional if `defaultProvider`/`defaultModel` were configured on the runtime. */
  readonly model?: ModelReference;
  readonly messages: readonly ModelMessage[];
  readonly temperature?: number;
  readonly maxOutputTokens?: number;
  readonly metadata?: Readonly<Record<string, unknown>>;
  /** Overrides the runtime's configured default timeout for this request only. */
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
}

export interface ModelRuntimeDefaults {
  readonly timeoutMs?: number;
  readonly retry?: RetryPolicy;
}

export interface CreateModelRuntimeOptions {
  readonly providers: readonly ModelProvider[];
  readonly defaults?: ModelRuntimeDefaults;
  readonly defaultProvider?: string;
  readonly defaultModel?: string;
  readonly onTelemetry?: ModelRuntimeTelemetryListener;
}

export interface ModelRuntime {
  stream(request: ModelExecutionRequest): AsyncGenerator<ModelStreamEvent, void, undefined>;
  readonly registry: ModelProviderRegistry;
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

function toProviderError(error: unknown): CopilotError {
  if (CopilotError.isCopilotError(error)) {
    return error;
  }
  if (error instanceof Error) {
    return CopilotError.provider(error.message, undefined, false);
  }
  return CopilotError.provider('Unknown provider error', { error: String(error) });
}

/**
 * Provider lookup, request normalization, streaming, cancellation, timeout, retry, and
 * usage/latency capture (Section 18) - a model *execution* runtime, not an agent runtime.
 * See `createModelExecutor` (model-executor.ts) for the bridge into `@gixcopilot/core`'s
 * generic `Executor` boundary.
 */
export function createModelRuntime(options: CreateModelRuntimeOptions): ModelRuntime {
  const registry = createModelProviderRegistry(options.providers);
  const retryPolicy = options.defaults?.retry ?? DEFAULT_RETRY_POLICY;

  return {
    registry,
    async *stream(
      request: ModelExecutionRequest,
    ): AsyncGenerator<ModelStreamEvent, void, undefined> {
      const providerId = request.model?.provider ?? options.defaultProvider;
      const modelName = request.model?.model ?? options.defaultModel;

      if (!providerId || !modelName) {
        yield {
          type: 'model.failed',
          error: CopilotError.validation(
            'No model was specified and no defaultProvider/defaultModel is configured.',
          ).toPublicJSON(),
        };
        return;
      }

      let provider: ModelProvider;
      try {
        provider = registry.require(providerId);
      } catch (error) {
        yield { type: 'model.failed', error: toProviderError(error).toPublicJSON() };
        return;
      }

      const timeoutMs = request.timeoutMs ?? options.defaults?.timeoutMs;
      const startedAt = Date.now();
      let firstChunkAt: number | undefined;
      let hasEmittedContent = false;
      let attempt = 0;

      const providerRequest: ModelRequest = {
        model: modelName,
        messages: request.messages,
        temperature: request.temperature,
        maxOutputTokens: request.maxOutputTokens,
        metadata: request.metadata,
      };

      while (true) {
        attempt += 1;
        options.onTelemetry?.({
          type: 'attempt_started',
          provider: providerId,
          model: modelName,
          attempt,
          maxAttempts: retryPolicy.maxAttempts,
        });

        const attemptController = new AbortController();
        linkExternalSignal(attemptController, request.signal);
        let timedOut = false;
        const timeoutHandle =
          timeoutMs !== undefined
            ? setTimeout(() => {
                timedOut = true;
                attemptController.abort();
              }, timeoutMs)
            : undefined;

        let attemptError: CopilotError | undefined;
        let finishReason: FinishReason | undefined;
        let usage: Usage | undefined;

        try {
          for await (const event of provider.stream(providerRequest, {
            signal: attemptController.signal,
          })) {
            switch (event.type) {
              case 'model.started':
                break;
              case 'content.delta':
                if (!hasEmittedContent) {
                  hasEmittedContent = true;
                  firstChunkAt = Date.now();
                }
                yield event;
                break;
              case 'usage.updated':
                usage = event.usage;
                yield event;
                break;
              case 'model.completed':
                finishReason = event.finishReason;
                usage = event.usage ?? usage;
                break;
              case 'model.failed':
                attemptError = new CopilotError(event.error.code, event.error.message, {
                  retryable: event.error.retryable,
                  metadata: event.error.metadata,
                });
                break;
            }
            if (attemptError) {
              break;
            }
          }

          if (!attemptError && attemptController.signal.aborted) {
            attemptError =
              request.signal?.aborted === true
                ? CopilotError.cancelled()
                : timedOut
                  ? CopilotError.timeout()
                  : CopilotError.cancelled();
          }
        } catch (error) {
          attemptError =
            request.signal?.aborted === true
              ? CopilotError.cancelled()
              : timedOut
                ? CopilotError.timeout()
                : toProviderError(error);
        } finally {
          if (timeoutHandle !== undefined) {
            clearTimeout(timeoutHandle);
          }
        }

        if (!attemptError) {
          options.onTelemetry?.({
            type: 'attempt_succeeded',
            provider: providerId,
            model: modelName,
            attempt,
          });
          const totalMs = Date.now() - startedAt;
          const latency: ModelLatency = {
            totalMs,
            ...(firstChunkAt !== undefined ? { timeToFirstChunkMs: firstChunkAt - startedAt } : {}),
          };
          const resolvedFinishReason = finishReason ?? 'unknown';
          options.onTelemetry?.({
            type: 'completed',
            provider: providerId,
            model: modelName,
            attempts: attempt,
            latency,
            finishReason: resolvedFinishReason,
            usage,
          });
          yield { type: 'model.completed', finishReason: resolvedFinishReason, usage };
          return;
        }

        const externallyCancelled = request.signal?.aborted === true;
        const willRetry =
          !externallyCancelled &&
          !hasEmittedContent &&
          attemptError.retryable &&
          attempt < retryPolicy.maxAttempts;

        options.onTelemetry?.({
          type: 'attempt_failed',
          provider: providerId,
          model: modelName,
          attempt,
          maxAttempts: retryPolicy.maxAttempts,
          code: attemptError.code,
          retryable: attemptError.retryable,
          willRetry,
        });

        if (!willRetry) {
          options.onTelemetry?.({
            type: 'failed',
            provider: providerId,
            model: modelName,
            attempts: attempt,
            code: attemptError.code,
          });
          yield { type: 'model.failed', error: attemptError.toPublicJSON() };
          return;
        }

        await sleep(computeBackoffDelayMs(retryPolicy, attempt), request.signal);
      }
    },
  };
}
