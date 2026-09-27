import { DestroyRef, effect, inject, isSignal, signal, untracked } from '@angular/core';
import type { Signal } from '@angular/core';
import type { z } from 'zod';
import type {
  ContextItemMetadata,
  ContextPriority,
  ContextRegistration,
  ContextScope,
  ContextSensitivity,
  StateScope,
  StateValidator,
} from '@gixcopilot/context';
import { toStatePatchToolDefinition } from '@gixcopilot/generative-ui';
import { defineTool } from '@gixcopilot/tools';
import type { ToolDefinition, ToolExecutionContext, ToolMetadata } from '@gixcopilot/tools';

type ToolSecurityManifest = ToolDefinition['security'];
import { CopilotService } from './copilot.service.js';

let sequence = 0;
const nextId = (prefix: string): string => `${prefix}-${++sequence}`;
const read = <V>(value: V | Signal<V>): V => (isSignal(value) ? value() : value);

/** The copilot provided by the nearest `provideCopilot()`. Call in an injection context. */
export function injectCopilot(): CopilotService {
  return inject(CopilotService);
}

export interface CopilotContextItem<T> {
  readonly id?: string;
  readonly name: string;
  readonly description?: string;
  readonly scope?: ContextScope;
  /** A value or a signal; a signal keeps the registered context current automatically. */
  readonly value: T | Signal<T>;
  readonly priority?: ContextPriority;
  readonly sensitivity?: ContextSensitivity;
  readonly enabled?: boolean | Signal<boolean>;
  readonly metadata?: ContextItemMetadata;
}

/**
 * Registers application context for the model (Phase 4) for the lifetime of the current
 * injection context (component, directive or service). Same registry and engine as the React
 * adapter; returns the registration so a caller can dispose it early.
 */
export function injectCopilotContext<T>(item: CopilotContextItem<T>): ContextRegistration<T> {
  const { parts } = inject(CopilotService);
  const registration = parts.registry.register<T>({
    id: item.id ?? nextId('angular-context'),
    name: item.name,
    scope: item.scope ?? 'component',
    value: untracked(() => read(item.value)),
    owner: 'angular-component',
  });
  effect(() => {
    registration.patch({
      name: item.name,
      description: item.description,
      scope: item.scope ?? 'component',
      value: read(item.value),
      priority: item.priority,
      sensitivity: item.sensitivity,
      enabled: item.enabled === undefined ? undefined : read(item.enabled),
      metadata: item.metadata,
    });
  });
  inject(DestroyRef).onDestroy(() => registration.dispose());
  return registration;
}

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
 * Registers a frontend tool (Phase 5) for the lifetime of the current injection context. It is
 * a canonical `ToolDefinition` executed by the same tool runtime (schema validation,
 * cancellation) as every other frontend tool; the server still decides whether the model may
 * call it.
 */
export function injectFrontendTool<TInputSchema extends z.ZodType, TOutputSchema extends z.ZodType | undefined = undefined>(
  options: FrontendToolOptions<TInputSchema, TOutputSchema>,
): void {
  const { parts } = inject(CopilotService);
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
  inject(DestroyRef).onDestroy(() => registration.dispose());
}

export type ExposeStateToModel =
  | boolean
  | { readonly description?: string; readonly priority?: ContextPriority; readonly sensitivity?: ContextSensitivity };

export interface CopilotStateOptions<T> {
  readonly id?: string;
  readonly name: string;
  readonly initialValue: T;
  readonly scope?: StateScope;
  readonly validate?: StateValidator<T>;
  /** Also register the current value as (read-only) model context. */
  readonly exposeToModel?: ExposeStateToModel;
  /** Let the model *propose* patches through the validated state-patch tool (Phase 6). */
  readonly modelWritable?: boolean;
}

export interface CopilotStateHandle<T> {
  readonly id: string;
  readonly value: Signal<T>;
  set(value: T): void;
  update(updater: (previous: T) => T): void;
}

/**
 * Shared application state (Phase 4/6) as a signal, backed by the same `CopilotStateStore` and
 * validation as the React adapter. Model writes arrive only through the validated state-patch
 * tool and only when `modelWritable` is set.
 */
export function injectCopilotState<T>(options: CopilotStateOptions<T>): CopilotStateHandle<T> {
  const { parts } = inject(CopilotService);
  const destroyRef = inject(DestroyRef);
  const id = options.id ?? nextId('angular-state');
  parts.stateStore.register<T>({
    id,
    name: options.name,
    initialValue: options.initialValue,
    scope: options.scope,
    validate: options.validate,
    modelWritable: options.modelWritable,
  });
  const value = signal<T>(parts.stateStore.get<T>(id) as T);
  const unsubscribe = parts.stateStore.subscribe<T>(id, () => value.set(parts.stateStore.get<T>(id) as T));
  destroyRef.onDestroy(unsubscribe);

  if (options.modelWritable) {
    const tool = toStatePatchToolDefinition(parts.stateStore, id, {
      name: options.name,
      description: `Propose a change to the "${options.name}" application state.`,
    });
    const registration = parts.toolRegistry.register(tool, { replace: true });
    destroyRef.onDestroy(() => registration.dispose());
  }

  const expose = options.exposeToModel;
  if (expose) {
    injectCopilotContext<T>({
      id: `${id}::state-context`,
      name: options.name,
      scope: 'session',
      value: value.asReadonly(),
      ...(expose === true ? {} : expose),
    });
  }

  return {
    id,
    value: value.asReadonly(),
    set: (next) => parts.stateStore.set<T>(id, next),
    update: (updater) => parts.stateStore.update<T>(id, updater),
  };
}
