import { assertValidToolName } from '@gixcopilot/tools';
import type { ToolDefinition } from '@gixcopilot/tools';
import type { AnyGenerativeComponentDefinition } from './component-definition.js';
import { toToolNameSegment } from './tool-name-segment.js';

/**
 * Section 66's "structured UI without a tool" is implemented, deliberately, as a call to a
 * **reserved, SDK-generated tool** - one per registered component - rather than as a new
 * protocol content part or a free-text `{component, props}` envelope the model fills in
 * itself. This is the single most consequential Phase 6 architectural decision; see
 * docs/adr/0011-generative-ui-and-state-patch-architecture.md for the full rationale. In
 * short:
 *
 *  - "No arbitrary component imports" (Section 18) becomes structural, not a runtime check:
 *    the model can only ever request a *tool name* that exists in its manifest, and the
 *    manifest only ever contains tool names this function derives from real, registered
 *    components - there is no free-text `component` field for the model to redirect.
 *  - Prop validation (Section 17) is **already-solved territory** by `@gixcopilot/tools`'
 *    `ToolRuntime`: the reserved tool's own `inputSchema` *is* the component's
 *    `propsSchema`, so the exact same Zod-validate-before-execute pipeline Phase 5 built
 *    (including "reject, don't coerce, on mismatch") applies with zero new code.
 *  - "Tool Runtime is never bypassed" (Section 35, 88 - mandatory for Phase 7 compatibility)
 *    is automatic: rendering a generative component **is** a tool call.
 *
 * Reserved tool names live under the fixed `ui.render.` namespace, camelCased from the
 * component's own PascalCase name (`ApplicationCard` -> `ui.render.applicationCard`) to
 * satisfy `@gixcopilot/tools`' dot-namespaced-camelCase naming rule.
 */
export const GENERATIVE_UI_TOOL_NAMESPACE = 'ui.render';

/** Derives this component's reserved tool name. Throws only if the result still is not a
 * valid tool name after camelCase sanitization (e.g. the component name has no letters at
 * all to anchor a valid segment on). */
export function generativeUiToolName(componentName: string): string {
  const name = `${GENERATIVE_UI_TOOL_NAMESPACE}.${toToolNameSegment(componentName)}`;
  assertValidToolName(name);
  return name;
}

export function isGenerativeUiToolName(toolName: string): boolean {
  return toolName.startsWith(`${GENERATIVE_UI_TOOL_NAMESPACE}.`);
}

/** The component name a reserved tool name was derived from, or `undefined` if it is not one. */
export function generativeUiComponentNameOfToolName(
  toolName: string,
  registry: { readonly list: () => readonly AnyGenerativeComponentDefinition[] },
): string | undefined {
  if (!isGenerativeUiToolName(toolName)) return undefined;
  return registry.list().find((component) => generativeUiToolName(component.name) === toolName)?.name;
}

/** What a `ui.render.*` reserved tool's `execute()` returns - the validated props, echoed
 * back so a renderer can trust them without re-deriving anything from the raw tool call. */
export interface GenerativeUiRenderResult {
  readonly component: string;
  readonly props: unknown;
}

/**
 * Builds the reserved, frontend-executed `ToolDefinition` for one registered component
 * (Section 8-9's registration API, bridged onto Section 26's "tool result -> UI" mechanism).
 * `execute()` does no real work beyond echoing its already-validated input back - by the
 * time it runs, `@gixcopilot/tools`' `ToolRuntime` has already Zod-validated `props` against
 * `component.propsSchema` (Section 16-17's pipeline, reused verbatim).
 */
export function toGenerativeUiToolDefinition(
  component: AnyGenerativeComponentDefinition,
): ToolDefinition<unknown, GenerativeUiRenderResult> {
  return {
    name: generativeUiToolName(component.name),
    description: component.description,
    inputSchema: component.propsSchema,
    execute(props) {
      return Promise.resolve({ component: component.name, props });
    },
    metadata: {
      source: 'frontend',
      executionLocation: 'client',
      category: component.metadata?.category ?? 'generative-ui',
      tags: component.metadata?.tags,
      readOnly: true,
      custom: { generativeUiComponent: component.name },
    },
  };
}
