import type { ModelRequest } from './model-request.js';
import type { ModelStreamEvent } from './model-stream-event.js';

export interface ModelExecutionOptions {
  /** Aborts when the run is cancelled or the runtime's timeout elapses. */
  readonly signal?: AbortSignal;
}

/**
 * The central provider abstraction (Section 8). Concrete adapters (`@gixcopilot/provider-
 * mock`, `@gixcopilot/provider-openai`, ...) implement this; nothing else in the system
 * needs to know which one it's talking to. A provider's `id` is how the registry (see
 * registry.ts) and a `ModelReference.provider` field refer to it.
 */
export interface ModelProvider {
  readonly id: string;
  stream(request: ModelRequest, options?: ModelExecutionOptions): AsyncIterable<ModelStreamEvent>;
}
