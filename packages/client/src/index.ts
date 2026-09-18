export { createCopilotClient } from './client.js';
export type {
  ClientMessageInput,
  ClientModelReference,
  ClientRun,
  CopilotClient,
  CopilotClientOptions,
  RunOptions,
} from './client.js';

export { createSseTransport } from './sse-transport.js';
export type { SseTransportOptions } from './sse-transport.js';

export type { CopilotTransport, TransportMessageInput, TransportRunRequest } from './transport.js';
