import { onScopeDispose, toValue, watch } from 'vue';
import type { MaybeRefOrGetter } from 'vue';
import type { z } from 'zod';
import type {
  ContextItemMetadata,
  ContextPriority,
  ContextRegistration,
  ContextScope,
  ContextSensitivity,
} from '@gixcopilot/context';
import { defineTool } from '@gixcopilot/tools';
import type { ToolDefinition, ToolExecutionContext, ToolMetadata } from '@gixcopilot/tools';
import { useCopilot } from './copilot.js';

let sequence = 0;
const nextId = (prefix: string): string => `${prefix}-${++sequence}`;

export interface CopilotContextItem<T> {
  readonly id?: string;
  readonly name: string;
  readonly description?: string;
  readonly scope?: ContextScope;
  /** A value, ref or getter; a ref or getter keeps the registered context current. */
  readonly value: MaybeRefOrGetter<T>;
  readonly priority?: ContextPriority;
  readonly sensitivity?: ContextSensitivity;
  readonly enabled?: MaybeRefOrGetter<boolean>;
  readonly metadata?: ContextItemMetadata;
}

/**
 * Registers application context for the model while the current component (or effect scope)
 * lives. Same registry and context engine as the React and Angular adapters: nothing is sent
 * unless it is registered here.
 */
export function useCopilotContext<T>(item: CopilotContextItem<T>): ContextRegistration<T> {
  const { parts } = useCopilot();
  const registration = parts.registry.register<T>({
    id: item.id ?? nextId('vue-context'),
    name: item.name,
    scope: item.scope ?? 'component',
    value: toValue(item.value),
    owner: 'vue-component',
  });
  const stop = watch(
    () => ({ value: toValue(item.value), enabled: item.enabled === undefined ? undefined : toValue(item.enabled) }),
    ({ value, enabled }) => {
      registration.patch({
        name: item.name,
        description: item.description,
        scope: item.scope ?? 'component',
        value,
        priority: item.priority,
        sensitivity: item.sensitivity,
        enabled,
        metadata: item.metadata,
      });
    },
    { immediate: true, deep: true, flush: 'sync' },
  );
  onScopeDispose(() => {
    stop();
    registration.dispose();
  });
  return registration;
}

type ToolSecurityManifest = ToolDefinition['security'];

export interface FrontendToolOptions<TInputSchema extends z.ZodType, TOutputSchema extends z.ZodType | undefined = undefined> {
  readonly name: string;
  readonly description: string;
  readonly input: TInputSchema;
  readonly output?: TOutputSchema;
  readonly execute: (
    input: z.infer<TInputSchema>,
    context: ToolExecutionContext,
  ) => Promise<TOutputSchema extends z.ZodType ? z.infer<TOutputSchema> : unknown>;
  readonly metadata?: Omit<ToolMetadata, 'source' | 'executionLocation'>;
  readonly security?: ToolSecurityManifest;
  readonly enabled?: boolean | (() => boolean);
}

/**
 * Registers a browser-side tool while the current component lives. It runs through the same
 * canonical tool runtime (schema validation, cancellation) as every frontend tool; the server
 * still decides whether the model may call it.
 */
export function useFrontendTool<TInputSchema extends z.ZodType, TOutputSchema extends z.ZodType | undefined = undefined>(
  options: FrontendToolOptions<TInputSchema, TOutputSchema>,
): void {
  const { parts } = useCopilot();
  const tool = defineTool({
    name: options.name,
    description: options.description,
    input: options.input,
    output: options.output,
    metadata: { ...options.metadata, source: 'frontend', executionLocation: 'client' },
    security: options.security,
    enabled: options.enabled,
    execute: (input, context) => options.execute(input, context),
  });
  const registration = parts.toolRegistry.register(tool, { replace: true });
  onScopeDispose(() => registration.dispose());
}
