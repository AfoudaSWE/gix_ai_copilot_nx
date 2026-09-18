import type { ContentPart, CopilotEvent, MessageRole } from '@gixcopilot/protocol';
import type { ClientModelReference } from './client.js';

export interface TransportMessageInput {
  readonly role: MessageRole;
  readonly content: readonly ContentPart[];
}

export interface TransportRunRequest {
  readonly threadId?: string;
  readonly model?: ClientModelReference;
  readonly messages: readonly TransportMessageInput[];
  readonly signal?: AbortSignal;
}

/**
 * The seam between @gixcopilot/client's public API and how a run's events actually arrive
 * over the wire. `createCopilotClient` depends only on this interface, not on SSE directly
 * - see the sdk-design skill's rule on headless, composable transport boundaries. Only an
 * SSE implementation exists in Phase 1; WebSocket is explicitly future work.
 */
export interface CopilotTransport {
  run(request: TransportRunRequest): AsyncIterable<CopilotEvent>;
  cancel(runId: string): Promise<void>;
}
