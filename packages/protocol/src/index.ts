export { PROTOCOL_VERSION, isSupportedProtocolVersion } from './version.js';
export type { ProtocolVersion } from './version.js';

export {
  createThreadId,
  createRunId,
  createMessageId,
  createEventId,
  asThreadId,
  asRunId,
} from './ids.js';
export type { ThreadId, RunId, MessageId, EventId } from './ids.js';

export { CopilotError } from './errors.js';
export type {
  CopilotErrorCode,
  CopilotErrorMetadata,
  CopilotErrorOptions,
  PublicCopilotError,
} from './errors.js';

export { createEmptyUsage, addUsage } from './usage.js';
export type { Usage } from './usage.js';

export type { FinishReason } from './finish-reason.js';

export type { MessageRole, ContentPart, Message } from './message.js';

export type { Thread } from './thread.js';

export type { RunStatus, Run } from './run.js';

export type {
  CopilotEventBase,
  RunStartedEvent,
  RunCompletedEvent,
  RunFailedEvent,
  RunCancelledEvent,
  MessageStartEvent,
  MessageDeltaEvent,
  MessageEndEvent,
  ErrorEvent,
  CopilotEvent,
  CopilotEventType,
  UnknownCopilotEvent,
} from './events.js';

export { parseEvent, serializeEvent } from './serialization.js';
export type { ParsedEvent } from './serialization.js';
