import type { Evaluator } from '../types.js';
import { defineEvaluator, ratio, result, skipped } from './common.js';

/** Section 109: question -> expected specialist. The routed (or root) agent must match. */
export function routingEvaluator(): Evaluator {
  const self = { id: 'agent-routing', metric: 'routing_accuracy' };
  return defineEvaluator({
    ...self,
    applies: (evalCase) => evalCase.expected?.agent !== undefined,
    evaluate({ evalCase, record }) {
      const selected = record.routing.at(-1)?.selectedAgentId ?? record.agents.find((agent) => agent.depth === 0)?.agentId;
      const ok = selected === evalCase.expected?.agent;
      return result(self, { value: ok ? 1 : 0, threshold: 1, passed: ok, evidence: [`expected ${evalCase.expected?.agent ?? ''}, routed to ${selected ?? '(nothing)'}`] });
    },
  });
}

/** Section 96: an agent that must not run for this request (e.g. an admin agent). */
export function forbiddenAgentsEvaluator(): Evaluator {
  const self = { id: 'forbidden-agents', metric: 'forbidden_agent_violations', security: true };
  return defineEvaluator({
    ...self,
    applies: (evalCase) => (evalCase.expected?.forbiddenAgents?.length ?? 0) > 0,
    evaluate({ evalCase, record }) {
      const forbidden = new Set(evalCase.expected?.forbiddenAgents ?? []);
      const ran = [...new Set(record.agents.filter((agent) => forbidden.has(agent.agentId)).map((agent) => agent.agentId))];
      return result(self, {
        value: ran.length === 0 ? 1 : 0,
        threshold: 1,
        passed: ran.length === 0,
        evidence: ran.map((id) => `FORBIDDEN agent ran: ${id}`),
        details: { violations: { 'forbidden-agent': ran.length } },
      });
    },
  });
}

/** Section 110: correct child agents, bounded depth. */
export function delegationEvaluator(): Evaluator {
  const self = { id: 'delegation', metric: 'delegation_accuracy' };
  return defineEvaluator({
    ...self,
    applies: (evalCase) => (evalCase.expected?.delegations?.length ?? 0) > 0 || evalCase.expected?.maxAgentDepth !== undefined,
    evaluate({ evalCase, record }) {
      const expected = evalCase.expected?.delegations ?? [];
      const delegated = new Set(record.delegations.map((delegation) => delegation.to));
      const missing = expected.filter((agentId) => !delegated.has(agentId));
      const depth = Math.max(0, ...record.agents.map((agent) => agent.depth));
      const depthOk = evalCase.expected?.maxAgentDepth === undefined || depth <= evalCase.expected.maxAgentDepth;
      const value = ratio(expected.length - missing.length, expected.length);
      return result(self, {
        value,
        threshold: 1,
        passed: value === 1 && depthOk,
        evidence: [`delegated to: ${[...delegated].join(', ') || '(none)'}`, `max depth ${depth}`, ...missing.map((id) => `missing delegation to ${id}`)],
        details: { depth, depthOk },
      });
    },
  });
}

/** Section 111: the active agent moved from the expected agent to the expected agent. */
export function handoffEvaluator(): Evaluator {
  const self = { id: 'handoff', metric: 'handoff_accuracy' };
  return defineEvaluator({
    ...self,
    applies: (evalCase) => evalCase.expected?.handoff !== undefined,
    evaluate({ evalCase, record }) {
      const expected = evalCase.expected?.handoff;
      const ok = record.handoffs.some((handoff) => handoff.from === expected?.from && handoff.to === expected.to);
      return result(self, { value: ok ? 1 : 0, threshold: 1, passed: ok, evidence: record.handoffs.map((handoff) => `${handoff.from} -> ${handoff.to} (${handoff.reason})`) });
    },
  });
}

interface PlanLike {
  readonly steps: readonly { readonly id: string; readonly type: string; readonly target?: string; readonly tool?: string; readonly agent?: string; readonly dependencies?: readonly string[] }[];
}

function isPlan(value: unknown): value is PlanLike {
  return typeof value === 'object' && value !== null && Array.isArray((value as { steps?: unknown }).steps);
}

/** Section 112: the target's structured plan is valid, bounded, acyclic and uses only known,
 * permitted tools/agents. A plan is never authorization - this only checks its shape. */
export function plannerEvaluator(): Evaluator {
  const self = { id: 'planner', metric: 'plan_validity' };
  return defineEvaluator({
    ...self,
    applies: (evalCase) => evalCase.expected?.plan !== undefined,
    evaluate({ evalCase, record }) {
      const expected = evalCase.expected?.plan ?? {};
      if (!isPlan(record.output)) return result(self, { value: 0, threshold: 1, passed: false, evidence: ['The output is not a plan with steps.'] });
      const steps = record.output.steps;
      if (steps.length === 0) return skipped(self, 'Empty plan.');
      const ids = new Set(steps.map((step) => step.id));
      const problems: string[] = [];
      if (expected.maxSteps !== undefined && steps.length > expected.maxSteps) problems.push(`${steps.length} steps exceeds the bound of ${expected.maxSteps}`);
      for (const step of steps) {
        const tool = step.tool ?? (step.type === 'tool' ? step.target : undefined);
        const agent = step.agent ?? (step.type === 'agent' ? step.target : undefined);
        if (tool && expected.knownTools && !expected.knownTools.includes(tool)) problems.push(`step ${step.id} uses unknown tool ${tool}`);
        if (tool && expected.forbiddenTools?.includes(tool)) problems.push(`step ${step.id} uses forbidden tool ${tool}`);
        if (agent && expected.knownAgents && !expected.knownAgents.includes(agent)) problems.push(`step ${step.id} uses unknown agent ${agent}`);
        for (const dependency of step.dependencies ?? []) if (!ids.has(dependency)) problems.push(`step ${step.id} depends on missing step ${dependency}`);
      }
      // Cycle detection over the dependency graph.
      const visiting = new Set<string>();
      const done = new Set<string>();
      const byId = new Map(steps.map((step) => [step.id, step]));
      const cyclic = (id: string): boolean => {
        if (done.has(id)) return false;
        if (visiting.has(id)) return true;
        visiting.add(id);
        const hit = (byId.get(id)?.dependencies ?? []).some(cyclic);
        visiting.delete(id);
        done.add(id);
        return hit;
      };
      if (steps.some((step) => cyclic(step.id))) problems.push('the dependency graph has a cycle');
      return result(self, { value: problems.length === 0 ? 1 : 0, threshold: 1, passed: problems.length === 0, evidence: problems });
    },
  });
}
