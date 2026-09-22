import { z } from 'zod';
import { CopilotError } from '@gixcopilot/protocol';
import type { ModelToolDefinition } from '@gixcopilot/provider';
import type { AnyAgentDefinition } from './definition.js';

const DELEGATE_TOOL_PREFIX = 'agent.delegate.';

export const delegateArgsSchema = z.object({
  task: z.string().min(1),
  input: z.unknown().optional(),
});

export function delegateToolName(targetAgentId: string): string {
  return `${DELEGATE_TOOL_PREFIX}${targetAgentId}`;
}

export function isDelegateToolCall(name: string): boolean {
  return name.startsWith(DELEGATE_TOOL_PREFIX);
}

export function parseDelegateTargetId(name: string): string {
  return name.slice(DELEGATE_TOOL_PREFIX.length);
}

/**
 * Delegation (A -> B -> A, Section 56-58) is only ever offered to the model as a reserved
 * tool for a target the agent's own definition statically declared in
 * `delegation.delegatesTo` - never an arbitrary model-supplied agent id (Section 65's "not
 * an arbitrary agent ID supplied by model output" applies equally to delegation and handoff).
 */
export function assertDelegationAllowed(fromAgent: AnyAgentDefinition, toAgentId: string): void {
  const allowed = fromAgent.delegation?.delegatesTo ?? [];
  if (!allowed.includes(toAgentId)) {
    throw CopilotError.agentDelegationDenied(
      `Agent "${fromAgent.id}" is not permitted to delegate to "${toAgentId}".`,
      { fromAgentId: fromAgent.id, toAgentId },
    );
  }
}

export function delegateModelToolDefinition(targetAgentId: string): ModelToolDefinition {
  return {
    name: delegateToolName(targetAgentId),
    description: `Delegate a subtask to the "${targetAgentId}" specialist agent and receive its structured result back. You remain the active agent - use this when you need the specialist's help to continue your own answer.`,
    parameters: z.toJSONSchema(delegateArgsSchema, { target: 'draft-7' }),
  };
}

/**
 * Least privilege (Section 55): a delegated run's visible tools are the intersection of the
 * delegating agent's own currently-visible tools and the target agent's declared allowlist -
 * NEVER their union. An orchestrator's permissions are therefore never expanded by having
 * specialists with broader individual permissions than the orchestrator itself can see.
 */
export function intersectToolNames(
  a: readonly string[],
  b: readonly string[] | undefined,
): readonly string[] {
  if (!b) return [];
  const bSet = new Set(b);
  return a.filter((name) => bSet.has(name));
}

/**
 * Same least-privilege narrowing as `intersectToolNames`, applied to declared knowledge
 * sources on delegation/handoff (Section 60, 131): a delegated/handed-off agent's effective
 * `knowledge.sources` is the intersection of its own declaration and the delegator's own
 * already-narrowed set, never a superset. This is declarative defense-in-depth only - the
 * actual RAG access-control boundary is Phase 9's `@gixcopilot/rag` permission-aware
 * retriever enforcing the trusted `SecurityContext` regardless of what any agent declares
 * (see `AgentKnowledgeConfig`'s own doc comment) - but a composition layer that naively reads
 * an agent's own `knowledge.sources` to scope a retrieval call gets an already-narrowed list
 * "for free" rather than having to re-derive the narrowing itself.
 */
export function intersectKnowledgeSources(
  declared: readonly string[] | undefined,
  restrictTo: readonly string[] | undefined,
): readonly string[] {
  if (!declared || !restrictTo) return [];
  const restrictSet = new Set(restrictTo);
  return declared.filter((source) => restrictSet.has(source));
}

/** Same narrowing as `intersectKnowledgeSources`, applied to declared memory types
 * (Section 60, 132) - declarative defense-in-depth; actual memory ownership/ACL enforcement
 * stays with Phase 9's `@gixcopilot/memory`, derived only from the trusted `SecurityContext`. */
export function intersectMemoryTypes(
  declared: readonly ('working' | 'session' | 'durable' | 'semantic')[] | undefined,
  restrictTo: readonly ('working' | 'session' | 'durable' | 'semantic')[] | undefined,
): readonly ('working' | 'session' | 'durable' | 'semantic')[] {
  if (!declared || !restrictTo) return [];
  const restrictSet = new Set(restrictTo);
  return declared.filter((type) => restrictSet.has(type));
}
