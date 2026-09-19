'use client';

import { useEffect, useId, useMemo, useRef } from 'react';
import type {
  ContextInspection,
  ContextItemMetadata,
  ContextPriority,
  ContextRegistration,
  ContextScope,
  ContextSensitivity,
  ResolvedContext,
} from '@gixcopilot/context';
import { useCopilotInternals } from './internals.js';

export interface UseCopilotContextOptions<T> {
  /** Stable identity across re-renders. Defaults to a generated, per-instance React id. */
  readonly id?: string;
  readonly name: string;
  readonly description?: string;
  /** Defaults to `'component'` - the scope a mounted component's own context normally is. */
  readonly scope?: ContextScope;
  readonly value: T;
  readonly priority?: ContextPriority;
  readonly sensitivity?: ContextSensitivity;
  /** Disabled context is stored but never reaches the model (Section 31). Defaults to `true`. */
  readonly enabled?: boolean;
  readonly metadata?: ContextItemMetadata;
}

/**
 * Registers application context for the lifetime of the calling component (Section 36-39).
 * Registration happens in an effect (not render) so React StrictMode's
 * mount→cleanup→mount double-invoke leaves exactly one live registration, mirroring
 * `CopilotProvider`'s own `store.mount()/dispose()` lifecycle pattern. Subsequent value/
 * option changes are pushed into the *same* registration via `patch()` (Section 38) rather
 * than disposing and re-registering - unrelated registry state is left alone.
 */
export function useCopilotContext<T>(options: UseCopilotContextOptions<T>): void {
  const { registry } = useCopilotInternals();
  const reactId = useId();
  const id = options.id ?? reactId;
  const registrationRef = useRef<ContextRegistration<T> | null>(null);

  useEffect(() => {
    const registration = registry.register<T>({
      id,
      name: options.name,
      scope: options.scope ?? 'component',
      value: options.value,
      owner: 'react-component',
    });
    registrationRef.current = registration;
    return () => {
      registration.dispose();
      registrationRef.current = null;
    };
    // Registration identity is (registry, id) only. Every other option is synced by the
    // effect below via `patch()`, without tearing this registration down.
  }, [registry, id]);

  useEffect(() => {
    registrationRef.current?.patch({
      name: options.name,
      description: options.description,
      scope: options.scope ?? 'component',
      value: options.value,
      priority: options.priority,
      sensitivity: options.sensitivity,
      enabled: options.enabled,
      metadata: options.metadata,
    });
  }, [
    options.name,
    options.description,
    options.scope,
    options.value,
    options.priority,
    options.sensitivity,
    options.enabled,
    options.metadata,
  ]);
}

export interface CopilotContextDebug {
  /** The same pipeline a run would use, run on demand (Section 90 - a DevTools foundation). */
  resolve(): Promise<ResolvedContext>;
  inspect(): Promise<ContextInspection>;
}

/** Low-level access to the provider's context registry/engine, for debugging/inspection. */
export function useCopilotContextDebug(): CopilotContextDebug {
  const { registry, engine } = useCopilotInternals();
  return useMemo(
    () => ({
      resolve: () => engine.resolve(registry),
      inspect: () => engine.inspect(registry),
    }),
    [registry, engine],
  );
}
