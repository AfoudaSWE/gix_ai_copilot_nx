import type { EventId, MessageId, RunId, ThreadId } from './ids.js';
import type { ProtocolVersion } from './version.js';
import type { MessageRole, ContentPart } from './message.js';
import type { Usage } from './usage.js';
import type { PublicCopilotError } from './errors.js';
import type { FinishReason } from './finish-reason.js';

/**
 * Naming convention (documented per the protocol-design skill's requirement to pick one
 * and record it):
 *  - TypeScript interface names are PascalCase and match the required Phase 1 list exactly
 *    (RunStartedEvent, MessageStartEvent, MessageEndEvent, ErrorEvent, ...).
 *  - The wire-level discriminator (`event.type`) is a lowercase `noun.verb` string, e.g.
 *    "run.started", "message.end". This is the string a consumer switches on.
 *
 * Every event carries enough to correlate, order, and version it without a lookup:
 *  - `id`         - unique id of this event (for de-duplication).
 *  - `runId` / `threadId` - correlation back to the run/thread it belongs to.
 *  - `sequence`   - 1-based, strictly increasing per run; see @aicopilot/core's sequencer.
 *  - `timestamp`  - ISO 8601, for debugging/ordering display only (sequence is authoritative
 *                   for ordering, not timestamp, since clocks are not a reliable ordering
 *                   source).
 *  - `protocolVersion` - see version.ts.
 */
export interface CopilotEventBase {
  readonly id: EventId;
  readonly runId: RunId;
  readonly threadId: ThreadId;
  readonly sequence: number;
  readonly timestamp: string;
  readonly protocolVersion: ProtocolVersion;
}

export interface RunStartedEvent extends CopilotEventBase {
  readonly type: 'run.started';
}

export interface RunCompletedEvent extends CopilotEventBase {
  readonly type: 'run.completed';
  readonly usage: Usage;
  /**
   * Added in Phase 2 (see docs/adr/0006-model-provider-abstraction.md) - optional so a
   * Phase 1 client that has never heard of finish reasons keeps working unmodified. Absent
   * for a run that didn't go through a model (e.g. the deterministic echo executor).
   */
  readonly finishReason?: FinishReason;
}

export interface RunFailedEvent extends CopilotEventBase {
  readonly type: 'run.failed';
  readonly error: PublicCopilotError;
}

export interface RunCancelledEvent extends CopilotEventBase {
  readonly type: 'run.cancelled';
}

export interface MessageStartEvent extends CopilotEventBase {
  readonly type: 'message.started';
  readonly messageId: MessageId;
  readonly role: MessageRole;
}

export interface MessageDeltaEvent extends CopilotEventBase {
  readonly type: 'message.delta';
  readonly messageId: MessageId;
  readonly delta: string;
}

export interface MessageEndEvent extends CopilotEventBase {
  readonly type: 'message.end';
  readonly messageId: MessageId;
  readonly content: readonly ContentPart[];
}

export interface ErrorEvent extends CopilotEventBase {
  readonly type: 'error';
  readonly error: PublicCopilotError;
}

export type CopilotEvent =
  | RunStartedEvent
  | RunCompletedEvent
  | RunFailedEvent
  | RunCancelledEvent
  | MessageStartEvent
  | MessageDeltaEvent
  | MessageEndEvent
  | ErrorEvent;

export type CopilotEventType = CopilotEvent['type'];

/**
 * An event whose `type` was not recognized by this build of the protocol package. Forward
 * compatibility: a client must be able to receive an event from a newer server without
 * crashing - see docs/adr/0003-event-driven-protocol.md. The base fields are still
 * validated and available; only the type-specific payload is unavailable.
 */
export interface UnknownCopilotEvent extends CopilotEventBase {
  readonly type: string;
}
