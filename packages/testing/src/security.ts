import { createActionFirewall, createActionFirewallMiddleware, createPermissionAwareToolResolver } from '@gixcopilot/security';
import type { ActionFirewall, CreateActionFirewallOptions, Identity, SecurityContext } from '@gixcopilot/security';
import { createStaticToolResolver } from '@gixcopilot/tools';
import type { AnyToolDefinition, ToolResolutionContext, ToolResolver, ToolRuntimeMiddleware } from '@gixcopilot/tools';
import type { DiagnosticEvent, SecurityDecisionDiagnostic } from '@gixcopilot/telemetry';
import { fail } from './assert.js';

export interface SecurityFixtureOptions {
  readonly subject?: string;
  readonly roles?: readonly string[];
  readonly permissions?: readonly string[];
  readonly tenantId?: string;
  readonly firewall?: CreateActionFirewallOptions;
}

export interface SecurityFixture {
  readonly securityContext: SecurityContext;
  readonly firewall: ActionFirewall;
  /** A permission-filtered resolver over `tools` for this identity (Section 34). */
  resolver(tools: readonly AnyToolDefinition[]): ToolResolver;
  /** The real Action Firewall middleware for a tool runtime (Phase 7). */
  middleware(resolver: ToolResolver): ToolRuntimeMiddleware;
}

/**
 * A trusted identity plus the REAL Phase 7 security stack for tests (Section 78): the
 * permission-aware resolver and the Action Firewall - never a stubbed "allow everything".
 */
export function createSecurityFixture(options: SecurityFixtureOptions = {}): SecurityFixture {
  const identity: Identity = { subject: options.subject ?? 'test-user', roles: options.roles ?? [], permissions: options.permissions ?? [] };
  const securityContext: SecurityContext = { identity, tenant: options.tenantId ? { tenantId: options.tenantId } : undefined };
  const firewall = createActionFirewall(options.firewall);
  return {
    securityContext,
    firewall,
    resolver: (tools) => createPermissionAwareToolResolver(createStaticToolResolver(tools), identity),
    middleware: (resolver) => createActionFirewallMiddleware({ firewall, resolver, getContext: () => securityContext }),
  };
}

type DiagnosticsLike = { readonly events: readonly DiagnosticEvent[] };

function decisionsFor(source: DiagnosticsLike, action: string): SecurityDecisionDiagnostic[] {
  return source.events.filter((event): event is SecurityDecisionDiagnostic => event.type === 'security.decision' && event.action === action);
}

/** Asserts the Action Firewall itself denied `action` - read from its recorded decision,
 * not inferred from the model's answer (ai-evals skill: permission compliance is explicit). */
export function expectActionDenied(source: DiagnosticsLike, action: string, options: { readonly reasonCode?: string } = {}): SecurityDecisionDiagnostic {
  const denied = decisionsFor(source, action).find((decision) => decision.decision === 'deny' && (!options.reasonCode || decision.reasonCode === options.reasonCode));
  if (!denied) fail(`Expected the firewall to deny "${action}"${options.reasonCode ? ` with ${options.reasonCode}` : ''}.`, { decisions: decisionsFor(source, action) });
  return denied;
}

export function expectApprovalRequired(source: DiagnosticsLike, action: string, options: { readonly level?: string } = {}): SecurityDecisionDiagnostic {
  const pending = decisionsFor(source, action).find((decision) => decision.decision === 'approval' && (!options.level || decision.approvalLevel === options.level));
  if (!pending) fail(`Expected "${action}" to require approval${options.level ? ` at level ${options.level}` : ''}.`, { decisions: decisionsFor(source, action) });
  return pending;
}

export function expectActionAllowed(source: DiagnosticsLike, action: string): SecurityDecisionDiagnostic {
  const allowed = decisionsFor(source, action).find((decision) => decision.decision === 'allow');
  if (!allowed) fail(`Expected the firewall to allow "${action}".`, { decisions: decisionsFor(source, action) });
  return allowed;
}

/** Asserts `name` is not even discoverable for this caller (Section 34, 78). */
export async function expectToolUnavailable(resolver: ToolResolver, name: string, context: ToolResolutionContext = { runId: 'test-run' }): Promise<void> {
  const tools = await resolver.resolve(context);
  if (tools.some((tool) => tool.name === name)) fail(`Expected tool "${name}" to be unavailable, but the resolver exposed it.`);
}
