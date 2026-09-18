import type { ModelMessage } from './model-message.js';

/**
 * The request shape a concrete `ModelProvider.stream()` receives. `model` is just the bare
 * model name (a string) - not a `ModelReference` - because a `ModelProvider` instance
 * already represents one fixed provider; which provider it is isn't repeated here. Compare
 * `ModelExecutionRequest` (model-runtime.ts), the runtime-facing request, which does carry
 * a full `ModelReference` because the runtime still has to route to the right provider.
 */
export interface ModelRequest {
  readonly model: string;
  readonly messages: readonly ModelMessage[];
  readonly temperature?: number;
  readonly maxOutputTokens?: number;
  readonly metadata?: Readonly<Record<string, unknown>>;
}
