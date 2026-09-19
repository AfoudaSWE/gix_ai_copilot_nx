'use client';

import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { ComponentType, ReactNode } from 'react';
import type { z } from 'zod';
import { createRunId, createToolCallId } from '@gixcopilot/protocol';
import type { ToolResult } from '@gixcopilot/protocol';
import {
  generativeUiComponentNameOfToolName,
  toGenerativeUiToolDefinition,
} from '@gixcopilot/generative-ui';
import type {
  AnyGenerativeComponentDefinition,
  GenerativeComponentMetadata,
  GenerativeUiRenderResult,
} from '@gixcopilot/generative-ui';
import { useCopilotInternals } from './internals.js';
import type { ToolRenderFn } from './internals.js';
import { useToolCalls } from './provider.js';
import type { ToolCallState } from './types.js';

export interface UseGenerativeComponentOptions<TProps> {
  readonly name: string;
  readonly description: string;
  readonly props: z.ZodType<TProps>;
  readonly component: ComponentType<TProps>;
  readonly metadata?: GenerativeComponentMetadata;
  readonly enabled?: boolean | (() => boolean);
}

/**
 * Registers a trusted, model-selectable component for the lifetime of the calling component
 * (Section 9-10), mirroring `useFrontendTool`'s register-in-effect/dispose-on-unmount
 * lifecycle and its "identity is (registry, name) only" convention (see
 * `frontend-tool-hooks.ts`) - a later render with new `description`/`props`/`metadata` does
 * not re-register (the same documented tradeoff `useFrontendTool` already makes); pass a new
 * `name` to intentionally re-register under a different identity.
 *
 * Registers into **two** places atomically: the framework-independent
 * `GenerativeComponentRegistry` (the definition) and this provider's frontend `ToolRegistry`
 * (the bridged `ui.render.<name>` tool - see `@gixcopilot/generative-ui`'s
 * `toGenerativeUiToolDefinition`) - the model can only ever "select" this component by
 * calling that reserved tool, validated by the exact same `ToolRuntime` pipeline
 * `useFrontendTool` uses (Section 62's zero-trust rule applies identically).
 */
export function useGenerativeComponent<TProps>(options: UseGenerativeComponentOptions<TProps>): void {
  const { generativeComponentRegistry, componentRenderers, toolRegistry } = useCopilotInternals();
  const componentRef = useRef(options.component);
  componentRef.current = options.component;

  useEffect(() => {
    const definition: AnyGenerativeComponentDefinition = {
      name: options.name,
      description: options.description,
      propsSchema: options.props,
      metadata: options.metadata,
    };
    const componentRegistration = generativeComponentRegistry.register(definition, { replace: true });
    componentRenderers.set(
      options.name,
      componentRef.current as ComponentType<Record<string, unknown>>,
    );
    const toolRegistration = toolRegistry.register(
      { ...toGenerativeUiToolDefinition(definition), enabled: options.enabled },
      { replace: true },
    );
    return () => {
      toolRegistration.dispose();
      componentRenderers.delete(options.name);
      componentRegistration.dispose();
    };
    // Registration identity is (registries, name) only - see the doc comment above.
  }, [generativeComponentRegistry, componentRenderers, toolRegistry, options.name]);
}

export interface UseToolRendererOptions {
  readonly tool: string;
  readonly render: ToolRenderFn;
}

/**
 * Attaches a custom renderer to a specific tool's activity (Section 27-31), independent of
 * whether that tool is a generative-UI component's own reserved tool or an ordinary Phase 5
 * tool (e.g. `applications.get`) whose *result* the host wants to visualize richly instead of
 * the generic "✓ applications.get completed" row. `render` is read through a ref (Section 48
 * pattern) so it always sees the calling component's latest closures.
 */
export function useToolRenderer(options: UseToolRendererOptions): void {
  const { toolRenderers } = useCopilotInternals();
  const renderRef = useRef(options.render);
  renderRef.current = options.render;

  useEffect(() => {
    const wrapped: ToolRenderFn = (state) => renderRef.current(state);
    toolRenderers.set(options.tool, wrapped);
    return () => {
      if (toolRenderers.get(options.tool) === wrapped) toolRenderers.delete(options.tool);
    };
  }, [toolRenderers, options.tool]);
}

/**
 * Lets trusted, developer-authored code (e.g. a registered generative component's own
 * `[Open]` button) invoke a registered tool directly - "Generated Component -> Registered
 * Tool -> Tool Runtime", explicitly *not* "-> AI -> Tool" (Section 33-35, 105-106). Routes
 * through this provider's own `ToolRuntime` (the exact same validate/execute/normalize
 * pipeline a model-initiated call uses - Section 35's "never bypass the Tool Runtime" rule),
 * with a freshly minted run/tool-call id since there is no real model run backing this call.
 * Never invoke a tool's `execute` directly - always go through this (or the model).
 */
export function useInvokeTool(): (name: string, args: unknown) => Promise<ToolResult> {
  const { toolRuntime } = useCopilotInternals();
  return useCallback(
    (name: string, args: unknown) =>
      toolRuntime.execute({
        toolCallId: createToolCallId(),
        name,
        arguments: args,
        context: { runId: createRunId(), signal: new AbortController().signal },
      }),
    [toolRuntime],
  );
}

function isGenerativeUiRenderResult(value: unknown): value is GenerativeUiRenderResult {
  return typeof value === 'object' && value !== null && 'component' in value && 'props' in value;
}

/**
 * Resolves one tool call's activity into custom content, or `undefined` to fall back to the
 * generic activity row (Section 30, 57) - never a crash or a raw-data dump. A registered
 * `useToolRenderer` for the exact tool name takes priority (works for *any* status,
 * including `requested`/`running`, so a host fully controls its own loading UI); otherwise, a
 * *succeeded* generative-UI request whose component is still registered renders that
 * component with its already-validated props (Section 17: validation happened in
 * `ToolRuntime.execute()`, well before this point - this function only reads the result, it
 * never re-parses untrusted input). `@gixcopilot/ui`'s `ToolActivity` wraps whatever this
 * returns in its own render-error boundary (Section 56) - this hook does not build one
 * itself, keeping error-boundary ownership in one place.
 */
export function useResolveToolRenderer(): (toolCall: ToolCallState) => ReactNode | undefined {
  const { generativeComponentRegistry, componentRenderers, toolRenderers } = useCopilotInternals();
  return useCallback(
    (toolCall: ToolCallState): ReactNode | undefined => {
      const customRenderer = toolRenderers.get(toolCall.name);
      if (customRenderer) {
        return customRenderer({
          status: toolCall.status,
          arguments: toolCall.arguments,
          result: toolCall.result,
          error: toolCall.error,
        });
      }

      if (toolCall.status !== 'succeeded') return undefined;
      const componentName = generativeUiComponentNameOfToolName(toolCall.name, generativeComponentRegistry);
      if (!componentName) return undefined;
      const Component = componentRenderers.get(componentName);
      if (!Component || !isGenerativeUiRenderResult(toolCall.result)) return undefined;
      // Safe: `props` was already Zod-validated against this exact component's own
      // propsSchema by ToolRuntime before this tool call could ever reach 'succeeded' - see
      // toGenerativeUiToolDefinition(). This is the one place that trust boundary is crossed.
      const props = toolCall.result.props as Record<string, unknown>;
      return <Component key={toolCall.id} {...props} />;
    },
    [generativeComponentRegistry, componentRenderers, toolRenderers],
  );
}

/** A generative-UI-specific projection of `useToolCalls()` (Section 58) - for a custom UI
 * that wants only structured-UI-request activity, not every tool call in the run. */
export interface GenerativeUIRequestState {
  readonly id: string;
  readonly component: string;
  readonly status: 'requested' | 'running' | 'succeeded' | 'failed';
  readonly props?: unknown;
  readonly error?: ToolCallState['error'];
}

function toGenerativeUIRequests(
  toolCalls: readonly ToolCallState[],
  generativeComponentRegistry: { readonly list: () => readonly AnyGenerativeComponentDefinition[] },
): readonly GenerativeUIRequestState[] {
  const requests: GenerativeUIRequestState[] = [];
  for (const toolCall of toolCalls) {
    const componentName = generativeUiComponentNameOfToolName(toolCall.name, generativeComponentRegistry);
    if (!componentName) continue;
    requests.push({
      id: toolCall.id,
      component: componentName,
      status: toolCall.status,
      props:
        toolCall.status === 'succeeded' && isGenerativeUiRenderResult(toolCall.result)
          ? toolCall.result.props
          : undefined,
      error: toolCall.error,
    });
  }
  return requests;
}

/** Only this run's generative-UI activity (Section 58), ordered as requested - a custom UI
 * that does not want ordinary tool-call noise mixed in. */
export function useGenerativeUIRequests(): readonly GenerativeUIRequestState[] {
  const toolCalls = useToolCalls();
  const { generativeComponentRegistry } = useCopilotInternals();
  return useMemo(
    () => toGenerativeUIRequests(toolCalls, generativeComponentRegistry),
    [toolCalls, generativeComponentRegistry],
  );
}
