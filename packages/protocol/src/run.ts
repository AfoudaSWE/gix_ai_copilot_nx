import type { RunId, ThreadId } from './ids.js';
import type { ProtocolVersion } from './version.js';
import type { Usage } from './usage.js';

/**
 * Run lifecycle states. @gixcopilot/core owns the state machine that enforces valid
 * transitions between these; this package only defines the shape.
 */
export type RunStatus = 'created' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface Run {
  readonly id: RunId;
  readonly threadId: ThreadId;
  readonly status: RunStatus;
  readonly protocolVersion: ProtocolVersion;
  readonly createdAt: string;
  readonly usage: Usage;
}
