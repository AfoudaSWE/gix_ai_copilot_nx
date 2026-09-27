import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadHttpApiManifest } from '@gixcopilot/connectors';
import type { HttpApi } from '@gixcopilot/connectors';
import { createMcpToolServer } from '@gixcopilot/mcp';
import type { McpToolServer } from '@gixcopilot/mcp';
import { createActionFirewall, createActionFirewallMiddleware, createDefaultRiskPolicy } from '@gixcopilot/security';
import type { AuditSink, SecurityContext } from '@gixcopilot/security';
import { createStaticToolResolver, createToolRuntime } from '@gixcopilot/tools';
import type { AnyToolDefinition } from '@gixcopilot/tools';
import type { CliIo, Flags } from './commands.js';
import { writePlan } from './files.js';
import { fileSlug } from './names.js';

const str = (flags: Flags, key: string): string | undefined => (typeof flags[key] === 'string' ? flags[key] : undefined);

function manifestTemplate(id: string, baseUrl: string): string {
  const env = `${id.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
  return `# API manifest for "${id}". Any HTTP/JSON (or GraphQL) API, in any language or framework.
# Every endpoint listed here becomes one copilot tool named "${id}.<name>".
# Nothing else is exposed. Credentials come from environment variables only.
id: ${id}
baseUrl: \${env:${env}_URL}        # e.g. ${baseUrl}
description: ${id} API
auth:
  type: bearer                    # none | bearer | apiKey | basic | headers
  tokenEnv: ${env}_TOKEN
defaultPermission: api.${id}      # permission every tool requires unless it sets "permissions"
endpoints:
  items.get:
    method: GET
    path: /items/{id}             # {id} comes from the input field "id"
    description: Get one item by id
    input:
      type: object
      properties:
        id: { type: string }
      required: [id]
  items.search:
    method: GET
    path: /items                  # other GET fields become query parameters
    description: Search items by text
    input:
      type: object
      properties:
        q: { type: string }
        limit: { type: integer, minimum: 1, maximum: 50 }
      required: [q]
  items.create:
    method: POST                  # POST/PUT/PATCH fields become the JSON body
    path: /items
    description: Create an item
    approval: user-confirmation   # writes need a confirmation by default anyway
    input:
      type: object
      properties:
        name: { type: string }
      required: [name]
# graphql:
#   path: /graphql
#   operations:
#     orders.byId:
#       description: Get an order
#       query: "query ($id: ID!) { order(id: $id) { id status } }"
#       variables: { type: object, properties: { id: { type: string } }, required: [id] }
`;
}

/** `aicopilot add api <id> [--url <base-url>]` writes a manifest to fill in. */
export async function addApi(io: CliIo, name: string | undefined, flags: Flags): Promise<number> {
  const id = name ? fileSlug(name) : undefined;
  if (!id) {
    io.err('Usage: aicopilot add api <id> [--url https://api.example.com] [--dir apis]');
    return 2;
  }
  const url = str(flags, 'url') ?? 'https://api.example.com';
  if (!/^https?:\/\//.test(url)) {
    io.err('--url must be http(s).');
    return 2;
  }
  const path = `${str(flags, 'dir') ?? 'apis'}/${id}.api.yaml`;
  const result = await writePlan(io.cwd, [{ path, content: manifestTemplate(id, url) }], { force: flags['force'] === true });
  if (result.written.length === 0) {
    io.err(`${path} already exists (use --force to replace).`);
    return 1;
  }
  io.out(`Created ${path}.`);
  io.out(`Next:\n  1. Describe your endpoints in ${path}\n  2. npx aicopilot api check ${path}\n  3. Use it: tools from loadHttpApiManifest('${path}') in your copilot server,\n     or expose it to any MCP client: npx aicopilot mcp serve ${path}`);
  return 0;
}

async function load(io: CliIo, file: string | undefined): Promise<HttpApi | undefined> {
  if (!file) {
    io.err('Missing manifest path, e.g. apis/crm.api.yaml');
    return undefined;
  }
  const path = resolve(io.cwd, file);
  if (!existsSync(path)) {
    io.err(`Manifest not found: ${file}`);
    return undefined;
  }
  return loadHttpApiManifest(path, { env: io.env });
}

/** `aicopilot api check <manifest>` validates a manifest and lists the tools it produces (no network). */
export async function apiCheck(io: CliIo, file: string | undefined, flags: Flags): Promise<number> {
  const api = await load(io, file);
  if (!api) return 2;
  const rows = api.tools.map((tool) => {
    const custom = (tool.metadata?.custom ?? {}) as { method?: string; path?: string; graphql?: string };
    return { name: tool.name, risk: tool.security?.risk ?? 'unclassified', call: custom.graphql ? `GraphQL ${custom.graphql}` : `${(custom.method ?? '').toUpperCase()} ${custom.path ?? ''}`, permissions: tool.security?.requiredPermissions ?? [], approval: tool.security?.approval };
  });
  if (flags['json'] === true) {
    io.out(JSON.stringify({ id: api.id, baseUrl: api.baseUrl, tools: rows }, null, 2));
    return 0;
  }
  io.out(`API "${api.id}" → ${api.baseUrl}: ${rows.length} tool(s)`);
  for (const row of rows) io.out(`  ${row.name.padEnd(32)} ${row.risk.padEnd(12)} ${row.call.padEnd(28)} ${row.permissions.join(',')}${row.approval ? `  approval: ${row.approval}` : ''}`);
  return 0;
}

export interface McpServeHandle {
  readonly tools: readonly string[];
  readonly url?: string;
  close(): Promise<void>;
}

/**
 * Builds the MCP server for a manifest: read-only tools only unless `allowWrites`, every call
 * through the Action Firewall as the local operator, audit records to stderr.
 */
export async function startMcpServe(io: CliIo, file: string | undefined, flags: Flags): Promise<McpServeHandle | undefined> {
  const api = await load(io, file);
  if (!api) return undefined;
  const allowWrites = flags['allow-writes'] === true;
  const tools: AnyToolDefinition[] = api.tools.filter((tool) => allowWrites || tool.security?.risk === 'read-only');
  const permissions = [...new Set(tools.flatMap((tool) => tool.security?.requiredPermissions ?? []))];
  const context: SecurityContext = { identity: { subject: `local-operator:${api.id}`, roles: ['operator'], permissions } };
  const audit: AuditSink = { write: (record) => Promise.resolve(io.err(`audit ${JSON.stringify({ tool: record.tool, decision: record.decision, at: record.timestamp })}`)) };
  // --allow-writes is an explicit operator decision: approvals would have no one to answer them here.
  const firewall = createActionFirewall({ audit, riskPolicy: createDefaultRiskPolicy(allowWrites ? { write: 'none', destructive: 'none', irreversible: 'none' } : {}) });
  const resolver = createStaticToolResolver(tools);
  const runtime = createToolRuntime({ resolver, middleware: [createActionFirewallMiddleware({ firewall, resolver, getContext: () => context })] });
  const server: McpToolServer = createMcpToolServer({ name: api.id, instructions: `Tools for the ${api.id} API.`, tools, runtime });
  const names = tools.map((tool) => tool.name);
  const hidden = api.tools.length - tools.length;
  io.err(`MCP server "${api.id}": ${names.length} tool(s)${hidden > 0 ? `, ${hidden} write tool(s) hidden (use --allow-writes to expose them)` : ''}.`);
  if (allowWrites) io.err('Warning: --allow-writes exposes write and destructive tools without approvals to every MCP client of this server.');

  if (flags['http'] !== true) {
    await server.connectStdio({ metadata: { operator: context.identity?.subject } });
    return { tools: names, close: () => server.close() };
  }

  const port = Number(str(flags, 'port') ?? '3333');
  const tokenEnv = str(flags, 'token-env');
  const token = tokenEnv ? io.env[tokenEnv] : undefined;
  if (tokenEnv && !token) {
    io.err(`Environment variable ${tokenEnv} is not set.`);
    return undefined;
  }
  const http = createServer((req: IncomingMessage, res: ServerResponse) => {
    void (async () => {
      if (!req.url?.startsWith('/mcp')) {
        res.writeHead(404).end();
        return;
      }
      if (token && req.headers.authorization !== `Bearer ${token}`) {
        res.writeHead(401, { 'www-authenticate': 'Bearer' }).end();
        return;
      }
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const headers = new Headers();
      for (const [name, value] of Object.entries(req.headers)) if (typeof value === 'string') headers.set(name, value);
      const body = chunks.length > 0 ? Buffer.concat(chunks) : undefined;
      const response = await server.handleRequest(new Request(`http://127.0.0.1:${port}${req.url}`, { method: req.method, headers, body }), { metadata: { operator: context.identity?.subject } });
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
    })().catch((error: unknown) => {
      io.err(`MCP request failed: ${error instanceof Error ? error.message : String(error)}`);
      if (!res.headersSent) res.writeHead(500).end();
    });
  });
  await new Promise<void>((resolveListen) => http.listen(port, '127.0.0.1', resolveListen));
  const address = http.address();
  const url = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : port}/mcp`;
  io.err(`Listening on ${url}${token ? ' (bearer token required)' : ''}`);
  return {
    tools: names,
    url,
    close: async () => {
      await server.close();
      await new Promise<void>((resolveClose) => http.close(() => resolveClose()));
    },
  };
}

/** `aicopilot mcp serve <manifest> [--http] [--port] [--token-env NAME] [--allow-writes]`. Runs until stopped. */
export async function mcpServe(io: CliIo, file: string | undefined, flags: Flags): Promise<number> {
  const handle = await startMcpServe(io, file, flags);
  if (!handle) return 2;
  await new Promise<void>((resolveStop) => {
    const stop = (): void => resolveStop();
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  });
  await handle.close();
  return 0;
}
