/**
 * Plain string aliases, not nominally-branded types. Branding was considered (to stop a
 * RunId being passed where a ThreadId is expected) but dropped: it fights the Zod schemas
 * in serialization.ts, which validate ids as plain strings, forcing a `.transform()` cast
 * on every id field in every schema for no behavioral benefit at Phase 1's scale. Revisit
 * if id confusion becomes an actual observed bug source - see the sdk-design skill's
 * "don't overengineer" guidance.
 */
export type ThreadId = string;
export type RunId = string;
export type MessageId = string;
export type EventId = string;
/** Added in Phase 5 (tools) - identifies one tool invocation across request/result/events. */
export type ToolCallId = string;

export function createThreadId(): ThreadId {
  return crypto.randomUUID();
}

export function createRunId(): RunId {
  return crypto.randomUUID();
}

export function createMessageId(): MessageId {
  return crypto.randomUUID();
}

export function createEventId(): EventId {
  return crypto.randomUUID();
}

export function createToolCallId(): ToolCallId {
  return crypto.randomUUID();
}

/** Identity casts that mark "this raw string is now trusted as an X id" at the call site. */
export function asThreadId(value: string): ThreadId {
  return value;
}

export function asRunId(value: string): RunId {
  return value;
}
