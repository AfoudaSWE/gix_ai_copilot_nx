import { z } from 'zod';
import { CopilotError } from '@gixcopilot/protocol';
import { generateObject } from '@gixcopilot/provider';
import type { ModelReference, ModelRuntime } from '@gixcopilot/provider';
import type { SecurityContext } from '@gixcopilot/security';

/**
 * Routing request/decision (Section 48). `candidateAgentIds` is the explicit, trusted
 * allowlist a route must resolve into - never inferred from whatever the model happens to
 * mention (Section 50-51).
 */
export interface AgentRouteRequest {
  readonly input: unknown;
  readonly securityContext: SecurityContext;
  readonly candidateAgentIds: readonly string[];
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface AgentRouteDecision {
  readonly agentId: string;
  readonly router: 'deterministic' | 'model';
  readonly reasonCode?: string;
}

export interface AgentRouter {
  route(request: AgentRouteRequest): Promise<AgentRouteDecision>;
}

export interface DeterministicRoute {
  readonly match: (request: AgentRouteRequest) => boolean;
  readonly agentId: string;
  readonly reasonCode?: string;
}

/**
 * Deterministic routing (Section 49) - explicit command/route/feature/intent-map rules,
 * evaluated in order, before ever falling back to a model call. Preferred over model routing
 * wherever a request can be classified without one (cheaper, faster, fully auditable).
 */
function routeDeterministically(
  routes: readonly DeterministicRoute[],
  fallbackAgentId: string | undefined,
  request: AgentRouteRequest,
): AgentRouteDecision {
  for (const route of routes) {
    if (route.match(request)) {
      if (!request.candidateAgentIds.includes(route.agentId)) {
        throw CopilotError.agentRoutingFailed(
          `Deterministic route matched agent "${route.agentId}", which is not in the allowed candidate list.`,
          { agentId: route.agentId, candidateAgentIds: request.candidateAgentIds },
        );
      }
      return { agentId: route.agentId, router: 'deterministic', reasonCode: route.reasonCode };
    }
  }
  if (fallbackAgentId && request.candidateAgentIds.includes(fallbackAgentId)) {
    return { agentId: fallbackAgentId, router: 'deterministic', reasonCode: 'FALLBACK' };
  }
  throw CopilotError.agentRoutingFailed('No deterministic route matched and no fallback agent was configured.');
}

export function createDeterministicRouter(
  routes: readonly DeterministicRoute[],
  fallbackAgentId?: string,
): AgentRouter {
  return {
    // Wrapped in `Promise.resolve().then(...)` (rather than an `async` method with no
    // `await`) so a synchronous throw below still surfaces as a rejected promise, matching
    // every other `AgentRouter`/`Promise`-returning API in this package.
    route: (request) => Promise.resolve().then(() => routeDeterministically(routes, fallbackAgentId, request)),
  };
}

export interface CreateModelBasedRouterOptions {
  readonly modelRuntime: ModelRuntime;
  readonly model?: ModelReference;
  readonly instructions?: string;
  readonly signal?: AbortSignal;
}

const routeDecisionSchema = z.object({
  agentId: z.string().min(1),
  reasonCode: z.string().min(1),
});

/**
 * Model-based routing (Section 50) - returns structured, schema-validated output (never a
 * free-form agent name the caller then has to fuzzy-match, Section 50's explicit
 * requirement). The model's chosen `agentId` is ALWAYS checked against
 * `request.candidateAgentIds` before being trusted (Section 51, 182, 206) - a model that
 * names an agent outside the allowlist (e.g. via a prompt-injection attempt in retrieved
 * content) never reaches execution.
 */
export function createModelBasedRouter(options: CreateModelBasedRouterOptions): AgentRouter {
  return {
    async route(request) {
      const result = await generateObject({
        runtime: options.modelRuntime,
        model: options.model,
        schema: routeDecisionSchema,
        signal: options.signal,
        messages: [
          {
            role: 'system',
            content: [
              {
                type: 'text',
                text:
                  options.instructions ??
                  `Choose exactly one agent id from this list to handle the request: ${request.candidateAgentIds.join(', ')}. Respond with {"agentId": "...", "reasonCode": "..."}.`,
              },
            ],
          },
          {
            role: 'user',
            content: [{ type: 'text', text: JSON.stringify(request.input) }],
          },
        ],
      });

      if (!request.candidateAgentIds.includes(result.object.agentId)) {
        throw CopilotError.agentRoutingFailed(
          `The model selected agent "${result.object.agentId}", which is not in the allowed candidate list.`,
          { agentId: result.object.agentId, candidateAgentIds: request.candidateAgentIds },
        );
      }

      return { agentId: result.object.agentId, router: 'model', reasonCode: result.object.reasonCode };
    },
  };
}
