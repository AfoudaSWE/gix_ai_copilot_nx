import { z } from 'zod';
import { assertValidToolName, toToolNameSegment } from '@gixcopilot/tools';
import type { ToolDefinition } from '@gixcopilot/tools';
import type { CopilotStateStore, StatePatch } from '@gixcopilot/context';

/**
 * Mirrors `generative-ui-tool.ts`'s decision exactly, applied to Section 36-49's "Shared
 * AI/UI State": a model-writable state slot is bridged into its own reserved, frontend-
 * executed tool rather than a new protocol concept. Calling this tool *is* proposing a
 * patch; `@gixcopilot/tools`' `ToolRuntime` already validates the envelope shape (`op`/
 * `value`/`baseRevision`) before `execute()` ever runs, and `execute()` itself defers the
 * writable/revision/value-schema checks entirely to `CopilotStateStore.applyPatch()`
 * (Section 43) - one pipeline, no duplicated logic.
 */
export const STATE_PATCH_TOOL_NAMESPACE = 'state.patch';

export function statePatchToolName(stateId: string): string {
  const name = `${STATE_PATCH_TOOL_NAMESPACE}.${toToolNameSegment(stateId)}`;
  assertValidToolName(name);
  return name;
}

export function isStatePatchToolName(toolName: string): boolean {
  return toolName.startsWith(`${STATE_PATCH_TOOL_NAMESPACE}.`);
}

const statePatchInputSchema = z.object({
  op: z.enum(['set', 'merge']),
  value: z.unknown(),
  baseRevision: z.number().int().min(0),
});

/**
 * The tool's *output* - deliberately the same shape as `StatePatchResult` (Section 43, 45).
 * A conflict or rejection is a normal, successful tool call whose data tells the model what
 * happened, not a thrown `ToolExecutionError` - a `@gixcopilot/tools` `ToolRuntime` error
 * would collapse every distinct outcome into one generic `TOOL_EXECUTION_ERROR` message
 * (see docs/phases/phase-06/Phase_6_Decisions.md), losing exactly the
 * "conflict vs. rejected, and why" distinction Section 45-46 needs the model to be able to
 * react to (e.g. re-reading the current value and retrying).
 */
const statePatchOutputSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('applied'), revision: z.number(), value: z.unknown() }),
  z.object({ status: z.literal('conflict'), currentRevision: z.number() }),
  z.object({
    status: z.literal('rejected'),
    reason: z.enum(['unknown-state', 'not-writable', 'invalid-value', 'invalid-patch']),
    detail: z.string().optional(),
  }),
]);

export type StatePatchToolOutput = z.infer<typeof statePatchOutputSchema>;

/** Builds the reserved tool for one `modelWritable` state slot (Section 38, 41-46). */
export function toStatePatchToolDefinition(
  stateStore: CopilotStateStore,
  stateId: string,
  options: { readonly name: string; readonly description: string },
): ToolDefinition<z.infer<typeof statePatchInputSchema>, StatePatchToolOutput> {
  return {
    name: statePatchToolName(stateId),
    description: options.description,
    inputSchema: statePatchInputSchema,
    outputSchema: statePatchOutputSchema,
    execute(input) {
      const patch: StatePatch = { op: input.op, value: input.value };
      const result = stateStore.applyPatch(stateId, patch, input.baseRevision);
      return Promise.resolve(result);
    },
    metadata: {
      source: 'frontend',
      executionLocation: 'client',
      category: 'shared-state',
      readOnly: false,
      idempotent: false,
      custom: { statePatchStateId: stateId, statePatchStateName: options.name },
    },
  };
}
