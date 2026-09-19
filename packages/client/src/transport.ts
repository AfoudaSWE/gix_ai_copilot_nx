import type {
  ContentPart,
  CopilotEvent,
  MessageRole,
  ToolManifestEntry,
  ToolResult,
} from '@gixcopilot/protocol';
import type { ClientModelReference } from './client.js';

export interface TransportMessageInput {
  readonly role: MessageRole;
  readonly content: readonly ContentPart[];
}

export interface TransportRunRequest {
  readonly threadId?: string;
  readonly model?: ClientModelReference;
  readonly messages: readonly TransportMessageInput[];
  /** Added in Phase 5 - frontend tools registered for this run only (Section 45-46). */
  readonly tools?: readonly ToolManifestEntry[];
  /** Direct action through the same server firewall, without a model round trip. */
  readonly action?: { readonly name: string; readonly arguments: Readonly<Record<string, unknown>> };
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
  /** Added in Phase 5 (Section 50) - reports a frontend tool's outcome back to the server so
   * a suspended Model -> Tool -> Model loop can resume. */
  submitToolResult(runId: string, toolCallId: string, result: ToolResult): Promise<void>;
  /** Added in Phase 7 (Section 83) - approves/rejects a pending action. The actual resolution
   * (`approval.approved`/`approval.rejected`) still arrives as an event on the original run's
   * own stream - this call only submits the decision, the same division of labor as
   * `submitToolResult` above. */
  decideApproval(approvalId: string, decision: 'approve' | 'reject', comment?: string): Promise<void>;
}
