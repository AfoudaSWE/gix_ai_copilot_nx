import { z } from 'zod';
import { CopilotError } from '@gixcopilot/protocol';
import type { ModelToolDefinition } from '@gixcopilot/provider';
import type { AnyAgentDefinition } from './definition.js';

const HANDOFF_TOOL_PREFIX = 'agent.handoff.';

export const handoffArgsSchema = z.object({
  reason: z.string().min(1),
  input: z.unknown().optional(),
});

export function handoffToolName(targetAgentId: string): string {
  return `${HANDOFF_TOOL_PREFIX}${targetAgentId}`;
}

export function isHandoffToolCall(name: string): boolean {
  return name.startsWith(HANDOFF_TOOL_PREFIX);
}

export function parseHandoffTargetId(name: string): string {
  return name.slice(HANDOFF_TOOL_PREFIX.length);
}

/**
 * Handoff (A -> B, B becomes active, Section 61-65) differs from delegation in that control
 * never returns to A. Validated only against the agent's own static `handoffTargets` graph -
 * an arbitrary model-suggested target is always rejected, regardless of what the model asked
 * for (Section 65).
 */
export function assertHandoffAllowed(fromAgent: AnyAgentDefinition, toAgentId: string): void {
  const allowed = fromAgent.delegation?.handoffTargets ?? [];
  if (!allowed.includes(toAgentId)) {
    throw CopilotError.agentHandoffTargetInvalid(fromAgent.id, toAgentId);
  }
}

export function handoffModelToolDefinition(targetAgentId: string): ModelToolDefinition {
  return {
    name: handoffToolName(targetAgentId),
    description: `Hand off the rest of this conversation to the "${targetAgentId}" agent. That agent becomes responsible for the final response - you will not see its result or continue afterward.`,
    parameters: z.toJSONSchema(handoffArgsSchema, { target: 'draft-7' }),
  };
}
