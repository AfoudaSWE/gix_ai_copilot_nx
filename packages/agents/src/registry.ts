import { CopilotError } from '@gixcopilot/protocol';
import type { AnyAgentDefinition } from './definition.js';

/**
 * Register/get/list/unregister (Section 13) - mirrors `@gixcopilot/tools`' `ToolRegistry`
 * shape deliberately, so the two feel like one family. No mandatory global singleton: an
 * application creates as many registries as it needs (Section 13's "prefer disposable
 * registration handles").
 */
export interface AgentRegistry {
  register(agent: AnyAgentDefinition): void;
  unregister(id: string): void;
  get(id: string): AnyAgentDefinition | undefined;
  list(): readonly AnyAgentDefinition[];
  has(id: string): boolean;
  clear(): void;
}

export interface CreateAgentRegistryOptions {
  /** Reject a second `register()` call for an already-registered id (default `true`) -
   * mirrors `ToolRegistry`'s "duplicate behavior must be deterministic" default. */
  readonly allowOverwrite?: boolean;
}

export function createAgentRegistry(options: CreateAgentRegistryOptions = {}): AgentRegistry {
  const allowOverwrite = options.allowOverwrite ?? false;
  const agents = new Map<string, AnyAgentDefinition>();

  return {
    register(agent) {
      if (!allowOverwrite && agents.has(agent.id)) {
        throw CopilotError.validation(
          `An agent is already registered with id "${agent.id}". Unregister it first or pass allowOverwrite: true.`,
          { agentId: agent.id },
        );
      }
      agents.set(agent.id, agent);
    },
    unregister(id) {
      agents.delete(id);
    },
    get(id) {
      return agents.get(id);
    },
    list() {
      return Array.from(agents.values());
    },
    has(id) {
      return agents.has(id);
    },
    clear() {
      agents.clear();
    },
  };
}

/**
 * Validates every `delegation.delegatesTo`/`delegation.handoffTargets` reference resolves to
 * an actually-registered agent (Section 66's "validate cycles/depth at runtime" - reference
 * validity is checked here; depth/cycle protection at execution time is `limits.ts`'s job,
 * since a graph of mutually-reachable agents is not itself invalid - only unbounded runtime
 * recursion through it is). Call this once after registering every agent, before serving
 * traffic - a dangling reference is a configuration bug, not a runtime condition to tolerate.
 */
export function validateAgentGraph(registry: AgentRegistry): void {
  for (const agent of registry.list()) {
    const targets = [
      ...(agent.delegation?.delegatesTo ?? []),
      ...(agent.delegation?.handoffTargets ?? []),
    ];
    for (const targetId of targets) {
      if (!registry.has(targetId)) {
        throw CopilotError.validation(
          `Agent "${agent.id}" declares a delegation/handoff target "${targetId}" that is not registered.`,
          { agentId: agent.id, targetId },
        );
      }
    }
  }
}
