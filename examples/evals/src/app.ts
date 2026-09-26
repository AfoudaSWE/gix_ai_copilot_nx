import { agentRoutingDecidedEvent, createAgentRegistry, createAgentRuntime } from '@gixcopilot/agents';
import type { AgentRunResult, AnyAgentDefinition } from '@gixcopilot/agents';
import { EventSequencer } from '@gixcopilot/core';
import type { MemoryStore } from '@gixcopilot/memory';
import { createModelRuntime } from '@gixcopilot/provider';
import type { ModelProvider } from '@gixcopilot/provider';
import type { Retriever } from '@gixcopilot/rag';
import { createActionFirewall, createActionFirewallMiddleware, createInMemoryApprovalStore, createPermissionAwareToolResolver } from '@gixcopilot/security';
import type { ActionFirewall, SecurityContext } from '@gixcopilot/security';
import { createFirewallTelemetry, createToolTelemetry, instrumentApprovalStore, instrumentModelRuntime, recordProtocolEvent, withTelemetryMetadata } from '@gixcopilot/telemetry';
import type { TelemetryAdapter } from '@gixcopilot/telemetry';
import { createStaticToolResolver, createToolRuntime } from '@gixcopilot/tools';
import type { ToolRuntimeMiddleware } from '@gixcopilot/tools';
import { createWorkflowEngine } from '@gixcopilot/workflows';
import type { WorkflowCheckpoint } from '@gixcopilot/workflows';
import { ROUTABLE_AGENTS, adminAgent, applicationApprovalWorkflow, paymentAgent, router, supportAgent } from './agents.js';
import type { User } from './data.js';
import { createKnowledgeBase, createMemory, createTools } from './tools.js';

export interface SupportCopilotOptions {
  /** Every diagnostic the app produces goes here - the eval runner's recording session. */
  readonly telemetry: TelemetryAdapter;
  readonly user: User;
  readonly providers: readonly ModelProvider[];
  /** Real-model mode: every agent uses this provider/model (e.g. OpenAI). */
  readonly live?: { readonly provider: string; readonly model: string };
  /**
   * REGRESSION DEMO ONLY - a realistic misconfiguration: tool discovery is not permission-
   * filtered and the Action Firewall runs in "audit only" mode (it records decisions but
   * does not enforce them). Used by the eval example to prove the security gate catches it.
   */
  readonly misconfigured?: boolean;
  readonly retriever?: Retriever;
  readonly memory?: MemoryStore;
  /** Minimum retrieval similarity; depends on the embedding model in use. */
  readonly retrievalThreshold?: number;
}

export interface SupportCopilot {
  readonly securityContext: SecurityContext;
  ask(message: string, signal?: AbortSignal): Promise<{ readonly agent: string; readonly result: AgentRunResult }>;
  startApprovalWorkflow(applicationId: string): Promise<WorkflowCheckpoint>;
}

/**
 * The application under evaluation, wired exactly as a production host would: permission-
 * aware discovery, the Action Firewall, telemetry on the model, tools, firewall, approvals,
 * retrieval and memory, and a deterministic router in front of the agents.
 */
export async function createSupportCopilot(options: SupportCopilotOptions): Promise<SupportCopilot> {
  const { telemetry, user } = options;
  const securityContext: SecurityContext = {
    identity: { subject: user.subject, roles: [...user.roles], permissions: [...user.permissions] },
    tenant: { tenantId: user.tenantId },
  };
  const tools = createTools({ retriever: options.retriever ?? (await createKnowledgeBase()), memory: options.memory ?? (await createMemory()), telemetry, retrievalThreshold: options.retrievalThreshold });
  const baseResolver = createStaticToolResolver(tools);
  const resolver = options.misconfigured ? baseResolver : createPermissionAwareToolResolver(baseResolver, securityContext.identity);

  const toolTelemetry = createToolTelemetry(telemetry);
  const instrumented = createFirewallTelemetry(telemetry, { tracker: toolTelemetry.tracker }).instrument(createActionFirewall());
  const firewall: ActionFirewall = {
    ...instrumented,
    evaluate: (request, context) => instrumented.evaluate(request, { ...context, metadata: withTelemetryMetadata(context.metadata, { correlation: { runId: request.runId, tenantId: user.tenantId } }) }),
  };
  const enforce = createActionFirewallMiddleware({ firewall, resolver, getContext: () => securityContext });
  const auditOnly: ToolRuntimeMiddleware = async (invocation, next) => {
    await enforce(invocation, () => Promise.resolve({ status: 'success', toolCallId: invocation.toolCallId, data: null }));
    return next(); // the misconfiguration: the decision is recorded, then ignored
  };
  const toolRuntime = toolTelemetry.instrument(
    createToolRuntime({ resolver, middleware: [options.misconfigured ? auditOnly : enforce, toolTelemetry.middleware], onEvent: (event) => toolTelemetry.onEvent(event) }),
  );

  const models = createModelRuntime({
    providers: [...options.providers],
    defaultProvider: options.live?.provider ?? options.providers[0]?.id,
    defaultModel: options.live?.model ?? 'test-model',
  });
  const traced = instrumentModelRuntime(models, telemetry);
  const modelRuntime = { registry: models.registry, stream: traced.stream.bind(traced) };

  const registry = createAgentRegistry();
  const withModel = (agent: AnyAgentDefinition): AnyAgentDefinition => (options.live ? { ...agent, model: { provider: options.live.provider, model: options.live.model } } : agent);
  for (const agent of [supportAgent, paymentAgent, adminAgent]) registry.register(withModel(agent));
  const runtime = createAgentRuntime({ registry, modelRuntime, toolRuntime, toolResolver: resolver, telemetry });

  return {
    securityContext,
    async ask(message, signal) {
      const decision = await router.route({ input: { message }, securityContext, candidateAgentIds: ROUTABLE_AGENTS });
      recordProtocolEvent(
        telemetry,
        agentRoutingDecidedEvent({ runId: globalThis.crypto.randomUUID(), threadId: globalThis.crypto.randomUUID() }, new EventSequencer(), decision.router, decision.agentId, ROUTABLE_AGENTS, decision.reasonCode),
        { tenantId: user.tenantId },
      );
      const result = await runtime.run({ agent: decision.agentId, input: { message }, securityContext, signal });
      return { agent: decision.agentId, result };
    },
    async startApprovalWorkflow(applicationId) {
      const engine = createWorkflowEngine({ telemetry, toolRuntime, approvals: instrumentApprovalStore(createInMemoryApprovalStore(), telemetry) });
      engine.register(applicationApprovalWorkflow);
      return engine.start({ workflowId: 'application-approval', input: { applicationId }, securityContext });
    },
  };
}
