'use client';

import { useEffect, useRef } from 'react';
import type { z } from 'zod';
import { defineTool } from '@gixcopilot/tools';
import type { ToolExecutionContext, ToolMetadata, ToolRegistration } from '@gixcopilot/tools';
import { useCopilotInternals } from './internals.js';

/**
 * Options for `useFrontendTool` (Section 44, 99-100) - deliberately the same shape as
 * `@gixcopilot/tools`' `defineTool` (name/description/input/output/execute/metadata/enabled)
 * so a tool definition looks and infers identically whether it runs on the server or in the
 * browser; only *where* it's registered (a React hook vs. a backend registry) differs.
 */
export interface UseFrontendToolOptions<
  TInputSchema extends z.ZodType,
  TOutputSchema extends z.ZodType | undefined = undefined,
> {
  readonly name: string;
  readonly description: string;
  readonly input: TInputSchema;
  readonly output?: TOutputSchema;
  readonly execute: (
    input: z.infer<TInputSchema>,
    context: ToolExecutionContext,
  ) => Promise<TOutputSchema extends z.ZodType ? z.infer<TOutputSchema> : unknown>;
  readonly metadata?: Omit<ToolMetadata, 'source' | 'executionLocation'>;
  readonly enabled?: boolean | (() => boolean);
}

/**
 * Registers a browser-executable tool for the lifetime of the calling component (Section 44-
 * 49), mirroring `useCopilotContext`'s register-in-effect/dispose-on-unmount lifecycle
 * (`context-hooks.ts`) so React StrictMode's mount->cleanup->mount double-invoke leaves
 * exactly one live registration. `execute` is read through a ref on every call (Section 48)
 * so the tool always runs against the calling component's *current* closures/state, even
 * though the registration itself is created once per (registry, name) - the same technique
 * `useCopilotState` relies on implicitly via `useCopilotContext`'s `patch()` path, applied
 * here directly since a tool registration is replaced wholesale (there is no partial patch
 * for a `ToolDefinition`).
 *
 * The model never executes arbitrary code (Section 64): only a tool a component has
 * explicitly registered here can ever run, and its arguments are validated against `input`
 * by `@gixcopilot/tools`' ToolRuntime (via `CopilotInternals.toolRuntime`) before `execute`
 * is ever called - see chat-store.ts's handling of a `tool.requested` event with
 * `source: 'frontend'`.
 */
export function useFrontendTool<
  TInputSchema extends z.ZodType,
  TOutputSchema extends z.ZodType | undefined = undefined,
>(options: UseFrontendToolOptions<TInputSchema, TOutputSchema>): void {
  const { toolRegistry } = useCopilotInternals();
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const registrationRef = useRef<ToolRegistration | null>(null);

  useEffect(() => {
    const tool = defineTool({
      name: optionsRef.current.name,
      description: optionsRef.current.description,
      input: optionsRef.current.input,
      output: optionsRef.current.output,
      metadata: { ...optionsRef.current.metadata, source: 'frontend', executionLocation: 'client' },
      enabled: optionsRef.current.enabled,
      // Reads `optionsRef.current` at call time, not at registration time - a later render
      // with a new `execute` closure (capturing fresh props/state) is picked up without
      // re-registering.
      execute: (input, context) => optionsRef.current.execute(input, context),
    });
    const registration = toolRegistry.register(tool, { replace: true });
    registrationRef.current = registration;
    return () => {
      registration.dispose();
      registrationRef.current = null;
    };
    // Registration identity is (toolRegistry, name) only - see context-hooks.ts's identical
    // convention and its rationale.
  }, [toolRegistry, options.name]);
}
