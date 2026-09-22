/**
 * Structured inter-agent messages (Section 67-68) - never a shared mutable object multiple
 * agents read/write concurrently. `payload` is validated against `schemaFor(type)` when the
 * caller registers one; an unregistered `type` passes through unvalidated (the same
 * opt-in-validation posture `@gixcopilot/tools`' `ToolDefinition.outputSchema` takes).
 */
export interface AgentMessage<TPayload = unknown> {
  readonly id: string;
  readonly fromAgentId: string;
  readonly toAgentId: string;
  readonly type: string;
  readonly payload: TPayload;
  readonly correlationId: string;
}

export interface AgentMessageBus {
  publish(message: AgentMessage): void;
  subscribe(toAgentId: string, listener: (message: AgentMessage) => void): () => void;
}

/**
 * A minimal in-process pub/sub for structured agent-to-agent messages (Section 67-69) -
 * deliberately not a distributed message bus; delegation/handoff (the primary Phase 10
 * communication paths) do not use this at all, since they are already modeled as direct,
 * auditable operations (see delegation.ts/handoff.ts). This exists for the narrower case of
 * a fire-and-forget notification between concurrently-running parallel specialists.
 */
export function createAgentMessageBus(): AgentMessageBus {
  const listenersByAgent = new Map<string, Set<(message: AgentMessage) => void>>();

  return {
    publish(message) {
      const listeners = listenersByAgent.get(message.toAgentId);
      if (!listeners) return;
      for (const listener of listeners) listener(message);
    },
    subscribe(toAgentId, listener) {
      let listeners = listenersByAgent.get(toAgentId);
      if (!listeners) {
        listeners = new Set();
        listenersByAgent.set(toAgentId, listeners);
      }
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
