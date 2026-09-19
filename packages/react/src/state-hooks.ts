'use client';

import { useCallback, useEffect, useId, useRef, useSyncExternalStore } from 'react';
import type { ContextPriority, ContextSensitivity, StateScope, StateValidator } from '@gixcopilot/context';
import { toStatePatchToolDefinition } from '@gixcopilot/generative-ui';
import { useCopilotContext } from './context-hooks.js';
import { useCopilotInternals } from './internals.js';

/** Exposing a state slot to the model is always an explicit opt-in (Section 44, 51). */
export type ExposeStateToModel =
  | boolean
  | {
      readonly description?: string;
      readonly priority?: ContextPriority;
      readonly sensitivity?: ContextSensitivity;
    };

export interface UseCopilotStateOptions<T> {
  /** Stable identity across re-renders and across components sharing this slot. */
  readonly id?: string;
  readonly name: string;
  readonly initialValue: T;
  readonly scope?: StateScope;
  readonly validate?: StateValidator<T>;
  /**
   * Controlled/external mode (Section 46): when both `value` and `onChange` are supplied,
   * this hook does not own the value - it bridges an application-owned value into the
   * shared store (for `exposeToModel`) and forwards writes to `onChange` instead of setting
   * the store directly, mirroring a controlled `<input>`.
   */
  readonly value?: T;
  readonly onChange?: (value: T) => void;
  /** Off by default - state is never sent to the model unless explicitly exposed. */
  readonly exposeToModel?: ExposeStateToModel;
  /**
   * Off by default (Section 38-39, added in Phase 6) - allows a validated AI-proposed patch
   * to change this slot's value, by auto-registering a reserved frontend tool
   * (`state.patch.<id>`, see `@gixcopilot/generative-ui`). Independent of `exposeToModel`:
   * a slot can be readable, writable, both, or neither - "read-only state" (Section 39) is
   * simply `exposeToModel` set without `modelWritable`.
   */
  readonly modelWritable?: boolean;
}

type SetCopilotState<T> = (next: T | ((previous: T) => T)) => void;

function resolveExposeConfig(expose: ExposeStateToModel | undefined): {
  readonly enabled: boolean;
  readonly description?: string;
  readonly priority?: ContextPriority;
  readonly sensitivity?: ContextSensitivity;
} {
  if (!expose) return { enabled: false };
  if (expose === true) return { enabled: true };
  return { enabled: true, ...expose };
}

/**
 * A typed, shared, subscribable state slot (Section 45) backed by the framework-independent
 * `CopilotStateStore` (`@gixcopilot/context`) - the store itself has no React dependency.
 * Multiple components passing the same `id` share one slot (Section 42's "multiple
 * consumers" case) rather than each owning a private copy.
 */
export function useCopilotState<T>(options: UseCopilotStateOptions<T>): readonly [T, SetCopilotState<T>] {
  const { stateStore, toolRegistry } = useCopilotInternals();
  const reactId = useId();
  const id = options.id ?? reactId;
  const isControlled = options.value !== undefined && options.onChange !== undefined;

  // Idempotent: only seeds the slot the first time this id is seen (Section 18). Must run
  // during render (not an effect) so the very first `useSyncExternalStore` snapshot below
  // already has a slot to read.
  stateStore.register<T>({
    id,
    name: options.name,
    initialValue: isControlled ? options.value : options.initialValue,
    scope: options.scope,
    validate: options.validate,
    modelWritable: options.modelWritable,
  });

  const nameRef = useRef(options.name);
  nameRef.current = options.name;
  const modelWritable = options.modelWritable ?? false;

  useEffect(() => {
    if (!modelWritable) return;
    const tool = toStatePatchToolDefinition(stateStore, id, {
      name: nameRef.current,
      description: `Propose a change to the "${nameRef.current}" application state.`,
    });
    const registration = toolRegistry.register(tool, { replace: true });
    return () => registration.dispose();
    // Identity is (toolRegistry, stateStore, id, modelWritable) only - the tool description
    // is read once at registration time, mirroring useFrontendTool's own documented tradeoff.
  }, [toolRegistry, stateStore, id, modelWritable]);

  const subscribe = useCallback(
    (listener: () => void) => stateStore.subscribe<T>(id, () => listener()),
    [stateStore, id],
  );
  const getSnapshot = useCallback(() => stateStore.get<T>(id) as T, [stateStore, id]);
  const storedValue = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  // Keep the store's copy in sync with an externally-owned value, so `exposeToModel` (which
  // always reads from the store) sees the latest controlled value too.
  useEffect(() => {
    if (isControlled && stateStore.get<T>(id) !== options.value) {
      stateStore.set<T>(id, options.value);
    }
  }, [isControlled, stateStore, id, options.value]);

  const setValue = useCallback<SetCopilotState<T>>(
    (next) => {
      if (isControlled) {
        const previous = options.value as T;
        const resolved = typeof next === 'function' ? (next as (value: T) => T)(previous) : next;
        options.onChange?.(resolved);
        return;
      }
      if (typeof next === 'function') {
        stateStore.update<T>(id, next as (value: T) => T);
      } else {
        stateStore.set<T>(id, next);
      }
    },
    [isControlled, options.value, options.onChange, stateStore, id],
  );

  const value = isControlled ? (options.value as T) : storedValue;
  const expose = resolveExposeConfig(options.exposeToModel);

  useCopilotContext<T>({
    id: `${id}::state-context`,
    name: options.name,
    description: expose.description,
    scope: 'session',
    priority: expose.priority,
    sensitivity: expose.sensitivity,
    value,
    enabled: expose.enabled,
  });

  return [value, setValue] as const;
}
