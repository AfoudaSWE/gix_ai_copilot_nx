import type { EventId, MessageId, RunId, ThreadId, ToolCallId } from './ids.js';
import type { ProtocolVersion } from './version.js';
import type { MessageRole, ContentPart } from './message.js';
import type { Usage } from './usage.js';
import type { PublicCopilotError } from './errors.js';
import type { FinishReason } from './finish-reason.js';
import type {
  ToolActionPreview,
  ToolActionRisk,
  ToolActionReversibility,
  ToolApprovalLevel,
  ToolSource,
} from './tool.js';

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
 *  - `sequence`   - 1-based, strictly increasing per run; see @gixcopilot/core's sequencer.
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
  /**
   * Ancestry, added in Phase 10 - see the matching fields on `Run` in run.ts. Optional so
   * every existing event shape (which has no parent) keeps working unmodified.
   */
  readonly rootRunId?: RunId;
  readonly parentRunId?: RunId;
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

/**
 * Tool lifecycle events, added in Phase 5 (see the tool-system skill). Emitted for every
 * tool call regardless of origin so a client can render generic tool activity - see
 * docs/phases/phase-05/Phase_5_Architecture.md. `tool.requested` is emitted once the model
 * asks for a call; for a `source: 'frontend'` call, the client (not the server) is
 * responsible for executing it and reporting the result back (Section 45).
 */
export interface ToolCallRequestedEvent extends CopilotEventBase {
  readonly type: 'tool.requested';
  readonly toolCallId: ToolCallId;
  readonly name: string;
  readonly arguments: Readonly<Record<string, unknown>>;
  readonly source: ToolSource;
}

export interface ToolCallStartedEvent extends CopilotEventBase {
  readonly type: 'tool.started';
  readonly toolCallId: ToolCallId;
  readonly name: string;
}

/**
 * `result` is the tool's already-serialized, size-bounded output (see
 * `@gixcopilot/tools`' result-serialization utility) - never an unbounded raw object, and
 * never assumed safe to display without the consuming UI's own judgment (Section 60).
 */
export interface ToolCallCompletedEvent extends CopilotEventBase {
  readonly type: 'tool.completed';
  readonly toolCallId: ToolCallId;
  readonly name: string;
  readonly result: unknown;
}

export interface ToolCallFailedEvent extends CopilotEventBase {
  readonly type: 'tool.failed';
  readonly toolCallId: ToolCallId;
  readonly name: string;
  readonly error: PublicCopilotError;
}

/**
 * Human-in-the-loop approval lifecycle (Phase 7, Section 89). A paused run keeps its SSE
 * connection open exactly the way a pending frontend tool call already does (Section 45) -
 * `approval.requested` is the explicit "this run is now waiting for a human" signal Section 88
 * asks for (in place of inventing a separate run-level state field: a client derives "waiting
 * for approval" from having seen `approval.requested` with no subsequent resolution event for
 * the same `approvalId`, and every resolution event closes that window unambiguously). A
 * `deny` decision does NOT get its own event type - it reuses the existing `tool.failed` event
 * with a Phase 7 error code (`PERMISSION_DENIED`, `POLICY_DENIED`, ...), per the action-
 * firewall skill's "reuse existing run/tool events where appropriate."
 */
export interface ApprovalRequestedEvent extends CopilotEventBase {
  readonly type: 'approval.requested';
  readonly approvalId: string;
  readonly toolCallId: ToolCallId;
  readonly action: string;
  readonly approvalLevel: ToolApprovalLevel;
  readonly summary: string;
  readonly risk?: ToolActionRisk;
  readonly reversibility?: ToolActionReversibility;
  readonly expiresAt?: string;
  /** A dry-run preview (Section 48-51, 136), when the tool declares a `dryRun` capability -
   * lets an Approval UI show "what would change" with no separate endpoint/round trip. */
  readonly preview?: ToolActionPreview;
}

export interface ApprovalApprovedEvent extends CopilotEventBase {
  readonly type: 'approval.approved';
  readonly approvalId: string;
  readonly toolCallId: ToolCallId;
  readonly decidedBy?: string;
}

export interface ApprovalRejectedEvent extends CopilotEventBase {
  readonly type: 'approval.rejected';
  readonly approvalId: string;
  readonly toolCallId: ToolCallId;
  readonly decidedBy?: string;
  readonly reason?: string;
}

export interface ApprovalExpiredEvent extends CopilotEventBase {
  readonly type: 'approval.expired';
  readonly approvalId: string;
  readonly toolCallId: ToolCallId;
}

/**
 * Agent lifecycle events, added in Phase 10 (see the agent-architecture skill and
 * docs/adr/0015). These are genuine new facts about a run - not a projection of existing
 * events the way generative-ui's `toProgressSteps()` projects tool-lifecycle events into UI
 * progress - so they are modeled as first-class `CopilotEvent` variants rather than derived
 * client-side. An agent run reuses the existing `run.*`/`tool.*`/`approval.*` events for
 * everything below the agent layer (model calls, tool calls, approvals); these events only
 * add the agent-specific facts those don't already carry.
 */
export interface AgentRunStartedEvent extends CopilotEventBase {
  readonly type: 'agent.run.started';
  readonly agentId: string;
  readonly agentRunId: string;
}

export interface AgentRunCompletedEvent extends CopilotEventBase {
  readonly type: 'agent.run.completed';
  readonly agentId: string;
  readonly agentRunId: string;
}

export interface AgentRunFailedEvent extends CopilotEventBase {
  readonly type: 'agent.run.failed';
  readonly agentId: string;
  readonly agentRunId: string;
  readonly error: PublicCopilotError;
}

export interface AgentRunCancelledEvent extends CopilotEventBase {
  readonly type: 'agent.run.cancelled';
  readonly agentId: string;
  readonly agentRunId: string;
}

/**
 * Delegation is `A -> B -> A` (B's result returns to A); handoff (below) is `A -> B` (B
 * becomes the active agent). See Sections 56-65 of the Phase 10 spec and the
 * agent-architecture skill's required `{fromAgent, toAgent, reason, correlationId}` shape.
 */
export interface AgentDelegationStartedEvent extends CopilotEventBase {
  readonly type: 'agent.delegation.started';
  readonly fromAgentId: string;
  readonly toAgentId: string;
  readonly delegationId: string;
  readonly depth: number;
}

export interface AgentDelegationCompletedEvent extends CopilotEventBase {
  readonly type: 'agent.delegation.completed';
  readonly fromAgentId: string;
  readonly toAgentId: string;
  readonly delegationId: string;
  readonly status: 'completed' | 'failed';
  readonly error?: PublicCopilotError;
}

export interface AgentHandoffEvent extends CopilotEventBase {
  readonly type: 'agent.handoff';
  readonly fromAgentId: string;
  readonly toAgentId: string;
  readonly reason: string;
}

/**
 * Emitted for every routing decision (deterministic or model-based) so it can be audited -
 * Section 47/51 of the Phase 10 spec requires routing decisions to be inspectable, and a
 * model-selected agent id must always have been validated against `candidateAgentIds`
 * before it is trusted (Section 50, 182).
 */
export interface AgentRoutingDecidedEvent extends CopilotEventBase {
  readonly type: 'agent.routing.decided';
  readonly router: 'deterministic' | 'model';
  readonly selectedAgentId: string;
  readonly candidateAgentIds: readonly string[];
  readonly reasonCode?: string;
}

/**
 * Workflow lifecycle events, added in Phase 10 (see docs/adr/0015). A workflow "paused"
 * state is a genuine explicit fact (not only inferrable from an unresolved
 * `approval.requested`, since a pause can also be triggered by a checkpoint boundary or an
 * explicit developer `pause()` call) so it gets its own event rather than being left to
 * client-side inference the way Run-level approval pauses are (Section 87, 107).
 */
export interface WorkflowRunStartedEvent extends CopilotEventBase {
  readonly type: 'workflow.run.started';
  readonly workflowId: string;
  readonly workflowRunId: string;
}

export interface WorkflowRunPausedEvent extends CopilotEventBase {
  readonly type: 'workflow.run.paused';
  readonly workflowId: string;
  readonly workflowRunId: string;
  readonly reason: 'approval' | 'checkpoint' | 'manual' | 'external-event';
  readonly stepId?: string;
}

export interface WorkflowRunResumedEvent extends CopilotEventBase {
  readonly type: 'workflow.run.resumed';
  readonly workflowId: string;
  readonly workflowRunId: string;
}

export interface WorkflowRunCompletedEvent extends CopilotEventBase {
  readonly type: 'workflow.run.completed';
  readonly workflowId: string;
  readonly workflowRunId: string;
}

export interface WorkflowRunFailedEvent extends CopilotEventBase {
  readonly type: 'workflow.run.failed';
  readonly workflowId: string;
  readonly workflowRunId: string;
  readonly error: PublicCopilotError;
}

export interface WorkflowRunCancelledEvent extends CopilotEventBase {
  readonly type: 'workflow.run.cancelled';
  readonly workflowId: string;
  readonly workflowRunId: string;
}

/**
 * `attempt` (1-based) carries retry without a separate retry-event family; `phase` carries
 * compensation without a separate compensation-event family - both reuse this one event
 * triad rather than proliferating near-duplicate events (Sections 117, 121, 202).
 */
export interface WorkflowStepStartedEvent extends CopilotEventBase {
  readonly type: 'workflow.step.started';
  readonly workflowRunId: string;
  readonly stepId: string;
  readonly stepType: 'function' | 'tool' | 'agent' | 'approval' | 'condition' | 'parallel';
  readonly attempt: number;
  readonly phase?: 'forward' | 'compensation';
}

export interface WorkflowStepCompletedEvent extends CopilotEventBase {
  readonly type: 'workflow.step.completed';
  readonly workflowRunId: string;
  readonly stepId: string;
  readonly attempt: number;
  readonly phase?: 'forward' | 'compensation';
}

export interface WorkflowStepFailedEvent extends CopilotEventBase {
  readonly type: 'workflow.step.failed';
  readonly workflowRunId: string;
  readonly stepId: string;
  readonly attempt: number;
  readonly phase?: 'forward' | 'compensation';
  readonly error: PublicCopilotError;
  readonly willRetry: boolean;
}

/** One event per successful checkpoint write - the resumability audit trail (Section 100). */
export interface WorkflowCheckpointSavedEvent extends CopilotEventBase {
  readonly type: 'workflow.checkpoint.saved';
  readonly workflowRunId: string;
  readonly stepId: string;
  readonly version: number;
}

export type CopilotEvent =
  | RunStartedEvent
  | RunCompletedEvent
  | RunFailedEvent
  | RunCancelledEvent
  | MessageStartEvent
  | MessageDeltaEvent
  | MessageEndEvent
  | ErrorEvent
  | ToolCallRequestedEvent
  | ToolCallStartedEvent
  | ToolCallCompletedEvent
  | ToolCallFailedEvent
  | ApprovalRequestedEvent
  | ApprovalApprovedEvent
  | ApprovalRejectedEvent
  | ApprovalExpiredEvent
  | AgentRunStartedEvent
  | AgentRunCompletedEvent
  | AgentRunFailedEvent
  | AgentRunCancelledEvent
  | AgentDelegationStartedEvent
  | AgentDelegationCompletedEvent
  | AgentHandoffEvent
  | AgentRoutingDecidedEvent
  | WorkflowRunStartedEvent
  | WorkflowRunPausedEvent
  | WorkflowRunResumedEvent
  | WorkflowRunCompletedEvent
  | WorkflowRunFailedEvent
  | WorkflowRunCancelledEvent
  | WorkflowStepStartedEvent
  | WorkflowStepCompletedEvent
  | WorkflowStepFailedEvent
  | WorkflowCheckpointSavedEvent;

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
