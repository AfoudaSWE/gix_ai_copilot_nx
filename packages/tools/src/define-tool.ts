import type { z } from 'zod';
import { assertValidToolName } from './tool-name.js';
import type { ToolDefinition, ToolExecutionContext } from './tool-definition.js';
import type { ToolMetadata } from './tool-metadata.js';

/**
 * The ergonomic authoring API (Section 9-10): pass Zod schemas as `input`/`output` and get
 * a fully-typed `execute(input, context)` back with no repeated type annotations - `TInput`/
 * `TOutput` are inferred from the schemas themselves via `z.infer`. `output` is optional;
 * when omitted, `execute`'s return type is inferred from its own return expression instead
 * (still no `any`, since `TOutput` defaults to `unknown` and the executor's declared return
 * type flows through normally).
 */
export interface DefineToolOptions<
  TInputSchema extends z.ZodType,
  TOutputSchema extends z.ZodType | undefined = undefined,
> {
  readonly name: string;
  readonly description: string;
  readonly input: TInputSchema;
  readonly output?: TOutputSchema;
  readonly execute: ToolExecutor<TInputSchema, TOutputSchema>;
  readonly metadata?: ToolMetadata;
  readonly enabled?: boolean | (() => boolean);
}

type ToolExecutor<
  TInputSchema extends z.ZodType,
  TOutputSchema extends z.ZodType | undefined,
> = (
  input: z.infer<TInputSchema>,
  context: ToolExecutionContext,
) => Promise<TOutputSchema extends z.ZodType ? z.infer<TOutputSchema> : unknown>;

export function defineTool<
  TInputSchema extends z.ZodType,
  TOutputSchema extends z.ZodType | undefined = undefined,
>(
  options: DefineToolOptions<TInputSchema, TOutputSchema>,
): ToolDefinition<
  z.infer<TInputSchema>,
  TOutputSchema extends z.ZodType ? z.infer<TOutputSchema> : unknown
> {
  assertValidToolName(options.name);
  type TOutput = TOutputSchema extends z.ZodType ? z.infer<TOutputSchema> : unknown;
  const definition: ToolDefinition<z.infer<TInputSchema>, TOutput> = {
    name: options.name,
    description: options.description,
    inputSchema: options.input as z.ZodType<z.infer<TInputSchema>>,
    outputSchema: options.output as z.ZodType<TOutput> | undefined,
    execute: options.execute,
    metadata: options.metadata,
    enabled: options.enabled,
  };
  return definition;
}
