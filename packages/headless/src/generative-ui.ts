import { generativeUiComponentNameOfToolName } from '@gixcopilot/generative-ui';
import type { AnyGenerativeComponentDefinition, GenerativeUiRenderResult } from '@gixcopilot/generative-ui';
import type { ToolCallState } from './types.js';

/** One model request to render a trusted, registered component (Phase 6), derived from the
 * tool-call timeline. `props` exist only once the request succeeded and passed the
 * component's schema validation in the tool runtime. */
export interface GenerativeUIRequestState {
  readonly id: string;
  readonly component: string;
  readonly status: 'requested' | 'running' | 'succeeded' | 'failed';
  readonly props?: unknown;
  readonly error?: ToolCallState['error'];
}

export function isGenerativeUiRenderResult(value: unknown): value is GenerativeUiRenderResult {
  return typeof value === 'object' && value !== null && 'component' in value && 'props' in value;
}

/** Projects tool calls onto generative-UI requests for registered components only; a tool call
 * naming an unregistered component is never turned into something renderable. */
export function toGenerativeUIRequests(
  toolCalls: readonly ToolCallState[],
  registry: { readonly list: () => readonly AnyGenerativeComponentDefinition[] },
): readonly GenerativeUIRequestState[] {
  const requests: GenerativeUIRequestState[] = [];
  for (const toolCall of toolCalls) {
    const component = generativeUiComponentNameOfToolName(toolCall.name, registry);
    if (!component) continue;
    requests.push({
      id: toolCall.id,
      component,
      status: toolCall.status,
      props: toolCall.status === 'succeeded' && isGenerativeUiRenderResult(toolCall.result) ? toolCall.result.props : undefined,
      error: toolCall.error,
    });
  }
  return requests;
}
