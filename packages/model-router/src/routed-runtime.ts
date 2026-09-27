import type { PublicCopilotError } from '@gixcopilot/protocol';
import type { ModelExecutionRequest, ModelReference, ModelRuntime, ModelStreamEvent } from '@gixcopilot/provider';
import type { HealthOutcome, ProviderHealth } from './health.js';
import { modelKey } from './router.js';
import type { ModelRoute, ModelRouter, ModelRoutingRequest } from './router.js';

/**
 * Errors that justify trying another model: transient provider trouble. Everything else
 * (invalid request, schema/structured-output errors, authentication/configuration errors,
 * unknown model, context too long, cancellation, security denials) is returned as-is
 * (Section 66): another model would either fail the same way or must not silently change the
 * outcome.
 */
const FALLBACK_CODES = new Set(['RATE_LIMITED', 'TIMEOUT', 'NETWORK_ERROR', 'PROVIDER_ERROR', 'MODEL_ERROR']);
const NEVER_FALLBACK_CODES = new Set([
  'PROTOCOL_ERROR',
  'VALIDATION_ERROR',
  'CANCELLED',
  'AUTHENTICATION_ERROR',
  'AUTHENTICATION_REQUIRED',
  'PERMISSION_DENIED',
  'TENANT_MISMATCH',
  'POLICY_DENIED',
  'BUSINESS_RULE_DENIED',
  'PII_POLICY_DENIED',
  'APPROVAL_REQUIRED',
  'APPROVAL_REJECTED',
  'APPROVAL_EXPIRED',
  'CONTEXT_LIMIT_EXCEEDED',
  'MODEL_NOT_FOUND',
  'TOOL_OUTPUT_INVALID',
]);

export function isFallbackEligible(error: PublicCopilotError): boolean {
  if (NEVER_FALLBACK_CODES.has(error.code)) return false;
  return FALLBACK_CODES.has(error.code) && (error.retryable || error.code === 'RATE_LIMITED' || error.code === 'TIMEOUT' || error.code === 'NETWORK_ERROR');
}

function healthOutcome(error: PublicCopilotError): HealthOutcome {
  if (error.code === 'RATE_LIMITED') return 'rate_limited';
  if (error.code === 'TIMEOUT') return 'timeout';
  return 'failure';
}

export interface RoutingDecisionEvent {
  readonly route: ModelRoute;
  readonly attempt: number;
  readonly model: ModelReference;
  readonly outcome: 'selected' | 'fallback' | 'no-fallback-after-output' | 'not-eligible' | 'exhausted';
  readonly errorCode?: string;
}

export interface CreateRoutedModelRuntimeOptions {
  /** The underlying runtime with every provider registered (it keeps its own per-model retry). */
  readonly runtime: ModelRuntime;
  readonly router: ModelRouter;
  readonly health?: ProviderHealth;
  /** Adds routing context (tenant/project/task) from the execution request's metadata. */
  readonly routingContext?: (request: ModelExecutionRequest) => Partial<ModelRoutingRequest>;
  readonly onDecision?: (event: RoutingDecisionEvent) => void;
}

/**
 * A `ModelRuntime` that routes each model call and falls back safely (Section 65-67):
 *
 * - One model CALL at a time, never a whole run. In the server's Model -> Tool -> Model loop,
 *   tool results already executed are part of the next call's history, so a fallback continues
 *   the conversation instead of repeating any side effect.
 * - Only before anything observable: once a call emitted text or a tool call, a failure is
 *   returned as-is (no second model re-answers or re-requests tools).
 * - Only for fallback-eligible errors, and never after cancellation.
 */
export function createRoutedModelRuntime(options: CreateRoutedModelRuntimeOptions): ModelRuntime {
  return {
    registry: options.runtime.registry,
    async *stream(request) {
      const route = await options.router.select({
        requested: request.model,
        requires: { ...(request.tools && request.tools.length > 0 ? { tools: true } : {}) },
        ...options.routingContext?.(request),
      });
      const chain = [route.primary, ...route.fallbacks];
      for (const [index, model] of chain.entries()) {
        options.onDecision?.({ route, attempt: index + 1, model, outcome: index === 0 ? 'selected' : 'fallback' });
        let emitted = false;
        let failure: PublicCopilotError | undefined;
        for await (const event of options.runtime.stream({ ...request, model })) {
          if (event.type === 'model.failed') {
            failure = event.error;
            break;
          }
          if (event.type === 'content.delta' || event.type === 'tool_call.requested') emitted = true;
          yield event;
          if (event.type === 'model.completed') options.health?.record(model, 'success');
        }
        if (!failure) return;
        options.health?.record(model, healthOutcome(failure));
        const last = index === chain.length - 1;
        const cancelled = request.signal?.aborted === true;
        if (emitted || cancelled || !isFallbackEligible(failure) || last) {
          options.onDecision?.({
            route,
            attempt: index + 1,
            model,
            outcome: emitted ? 'no-fallback-after-output' : last && isFallbackEligible(failure) ? 'exhausted' : 'not-eligible',
            errorCode: failure.code,
          });
          const failed: ModelStreamEvent = { type: 'model.failed', error: failure };
          yield failed;
          return;
        }
      }
    },
  };
}

export { modelKey };
