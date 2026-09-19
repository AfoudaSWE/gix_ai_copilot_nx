import { CopilotError } from '@gixcopilot/protocol';
import type { ToolApprovalLevel } from '@gixcopilot/protocol';
import type { ToolResolver, ToolRuntimeMiddleware } from '@gixcopilot/tools';
import type { ActionFirewall } from './action-firewall.js';
import type { SecurityContext } from './identity.js';

/** Trusted host callbacks; never populate approval grants from browser/model metadata. */
export interface FirewallMiddlewareOptions {
  readonly firewall: ActionFirewall;
  readonly resolver: ToolResolver;
  readonly getContext: () => SecurityContext | Promise<SecurityContext>;
  readonly hasApproval?: (toolCallId: string, level: ToolApprovalLevel) => boolean;
  /** Set only when a host already evaluated/rate-limited this same action. */
  readonly revalidation?: boolean;
}

/** Enforces the firewall at the canonical ToolRuntime middleware boundary. */
export function createActionFirewallMiddleware(options: FirewallMiddlewareOptions): ToolRuntimeMiddleware {
  return async (invocation, next) => {
    const { toolCallId, name } = invocation;
    const fail = (error: CopilotError) => ({ status: 'error' as const, toolCallId, error: error.toPublicJSON() });
    if (invocation.context.signal.aborted) return fail(CopilotError.cancelled());
    const tools = await options.resolver.resolve(invocation.context);
    const tool = tools.find((candidate) => candidate.name === name);
    if (!tool) return fail(CopilotError.toolNotFound(name));
    const decision = await options.firewall.evaluate({
      actionId: toolCallId, runId: invocation.context.runId, toolCallId, action: name,
      arguments: invocation.arguments, revalidation: options.revalidation,
      metadata: { ...tool.security, toolName: name, source: tool.metadata?.executionLocation === 'client' ? 'frontend' : 'backend' },
    }, await options.getContext());
    if (decision.decision === 'deny') return fail(new CopilotError(decision.reason.code, decision.reason.message));
    if (decision.decision === 'approval' && !options.hasApproval?.(toolCallId, decision.approval.level)) {
      return fail(CopilotError.approvalRequired(decision.approval.level, ''));
    }
    if (invocation.context.signal.aborted) return fail(CopilotError.cancelled());
    return next();
  };
}
