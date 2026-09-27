import { createMcpToolServer } from '@gixcopilot/mcp';
import { createActionFirewall, createActionFirewallMiddleware, createInMemoryAuditSink } from '@gixcopilot/security';
import type { SecurityContext } from '@gixcopilot/security';
import { createStaticToolResolver, createToolRuntime } from '@gixcopilot/tools';
import { crm } from './connector.js';

declare function authenticate(request: Request): Promise<SecurityContext>; // your identity check

const resolver = createStaticToolResolver(crm.tools);
const firewall = createActionFirewall({ audit: createInMemoryAuditSink() });

export const mcp = createMcpToolServer({
  name: 'crm',
  tools: crm.tools,
  // Each MCP call runs as the authenticated caller, through the Action Firewall.
  runtime: ({ metadata }) =>
    createToolRuntime({
      resolver,
      middleware: [createActionFirewallMiddleware({ firewall, resolver, getContext: () => metadata?.['security'] as SecurityContext })],
    }),
});

// Streamable HTTP (e.g. a Next.js route handler: export const POST = handler)
export async function handler(request: Request): Promise<Response> {
  return mcp.handleRequest(request, { metadata: { security: await authenticate(request) } });
}
