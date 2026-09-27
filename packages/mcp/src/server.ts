import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';
import { createRunId, createToolCallId } from '@gixcopilot/protocol';
import { isToolEnabled, toToolManifestEntry } from '@gixcopilot/tools';
import type { AnyToolDefinition, ToolExecutionContext, ToolRuntime } from '@gixcopilot/tools';

/** Per-connection or per-request facts about the caller, passed to tools as `context.metadata`. */
export interface McpCallContext {
  readonly metadata?: Readonly<Record<string, unknown>>;
}

type Resolve<T> = T | ((context: McpCallContext) => T | Promise<T>);

export interface McpToolServerOptions {
  /** Server name shown to MCP clients (e.g. "crm"). */
  readonly name: string;
  readonly version?: string;
  /** Guidance for the calling model, sent in the MCP `initialize` response. */
  readonly instructions?: string;
  /** Tools to list. A function can filter by caller (for example a permission-aware resolver). */
  readonly tools: Resolve<readonly AnyToolDefinition[]>;
  /**
   * Executes every call. Build it with `createToolRuntime({ resolver, middleware:
   * [createActionFirewallMiddleware(...)] })` so exposed tools keep authentication,
   * permissions, approvals and audit. It is required: an MCP server never executes tools
   * outside a runtime you configured.
   */
  readonly runtime: Resolve<ToolRuntime>;
}

export interface McpToolServer {
  /** Serves over stdio (for desktop assistants and IDEs that launch the server as a process). */
  connectStdio(context?: McpCallContext): Promise<void>;
  /**
   * Handles one Streamable HTTP request (web-standard `Request` → `Response`), statelessly.
   * Works in Node 18+, Next.js route handlers, Deno, Bun and edge runtimes. Authenticate the
   * request first and pass the caller in `context`.
   */
  handleRequest(request: Request, context?: McpCallContext): Promise<Response>;
  close(): Promise<void>;
}

async function resolve<T>(value: Resolve<T>, context: McpCallContext): Promise<T> {
  return typeof value === 'function' ? (value as (context: McpCallContext) => T | Promise<T>)(context) : value;
}

function toMcpTool(tool: AnyToolDefinition): Tool {
  const entry = toToolManifestEntry(tool);
  const risk = tool.security?.risk;
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: { type: 'object', ...(entry.parameters as Record<string, unknown>) },
    annotations: {
      readOnlyHint: risk === 'read-only',
      destructiveHint: risk === 'destructive',
      idempotentHint: risk === 'read-only',
      openWorldHint: tool.metadata?.source === 'openapi' || tool.metadata?.source === 'connector' || tool.metadata?.source === 'mcp',
    },
  };
}

function toCallResult(result: Awaited<ReturnType<ToolRuntime['execute']>>): CallToolResult {
  if (result.status === 'error') {
    return { isError: true, content: [{ type: 'text', text: `${result.error.code}: ${result.error.message}` }] };
  }
  const data = result.data;
  const text = typeof data === 'string' ? data : JSON.stringify(data ?? null);
  return {
    content: [{ type: 'text', text }],
    ...(data !== null && typeof data === 'object' && !Array.isArray(data) ? { structuredContent: data as Record<string, unknown> } : {}),
  };
}

/**
 * Exposes copilot tools (hand-written, OpenAPI-generated or connector-generated) as an MCP
 * server, so any MCP client (desktop assistants, IDEs, other agents) can use the connected
 * application. Only listed tools are visible; each call goes through the runtime you supply,
 * so the Action Firewall still decides. Tool errors are returned as MCP tool errors with the
 * public error code only (never stack traces or credentials).
 */
export function createMcpToolServer(options: McpToolServerOptions): McpToolServer {
  if (!options.name.trim()) throw new Error('An MCP server needs a name.');
  if (options.runtime === undefined) throw new Error('createMcpToolServer requires a tool runtime (with the Action Firewall middleware).');
  const servers = new Set<Server>();

  function build(context: McpCallContext): Server {
    const server = new Server({ name: options.name, version: options.version ?? '0.1.0' }, { capabilities: { tools: {} }, ...(options.instructions ? { instructions: options.instructions } : {}) });
    server.setRequestHandler(ListToolsRequestSchema, async () => {
      const tools = await resolve(options.tools, context);
      return { tools: tools.filter((tool) => isToolEnabled(tool)).map(toMcpTool) };
    });
    server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
      const tools = await resolve(options.tools, context);
      const listed = tools.some((tool) => tool.name === request.params.name && isToolEnabled(tool));
      if (!listed) return { isError: true, content: [{ type: 'text', text: `TOOL_NOT_FOUND: Unknown tool "${request.params.name}".` }] };
      const runtime = await resolve(options.runtime, context);
      const executionContext: ToolExecutionContext = {
        runId: createRunId(),
        signal: extra.signal,
        metadata: { ...context.metadata, transport: 'mcp', mcpServer: options.name },
      };
      const result = await runtime.execute({
        toolCallId: createToolCallId(),
        name: request.params.name,
        arguments: request.params.arguments ?? {},
        context: executionContext,
      });
      return toCallResult(result);
    });
    servers.add(server);
    server.onclose = () => servers.delete(server);
    return server;
  }

  return {
    async connectStdio(context = {}) {
      await build(context).connect(new StdioServerTransport());
    },
    async handleRequest(request, context = {}) {
      // Stateless Streamable HTTP: a fresh server and transport per request.
      const server = build(context);
      const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      await server.connect(transport);
      try {
        return await transport.handleRequest(request);
      } finally {
        void server.close();
      }
    },
    async close() {
      await Promise.all([...servers].map((server) => server.close()));
    },
  };
}
