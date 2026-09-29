import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { createCopilotClient } from '@gixcopilot/client';
import type { ClientMessageInput, CopilotClient } from '@gixcopilot/client';
import { createRuntime } from '@gixcopilot/core';
import { createModelExecutor, createModelRuntime } from '@gixcopilot/provider';
import type { ModelProvider, ModelReference, ModelRuntime, RetryPolicy } from '@gixcopilot/provider';
import type { CopilotEvent, PublicCopilotError, Usage } from '@gixcopilot/protocol';
import type { ActionFirewall, ApprovalStore, AuthenticationAdapter, DataPolicy, RolePermissionMap } from '@gixcopilot/security';
import { createServer } from '@gixcopilot/server';
import type { CreateServerOptions } from '@gixcopilot/server';
import type { TelemetryAdapter } from '@gixcopilot/telemetry';
import { createToolRegistry } from '@gixcopilot/tools';
import type { AnyToolDefinition, ToolRegistry } from '@gixcopilot/tools';

type FastifyApp = ReturnType<typeof createServer>;

export interface CopilotSecurityOptions {
  /** Resolves the caller's identity and tenant from each request (never from model output). */
  readonly authentication?: AuthenticationAdapter;
  /** The Action Firewall every backend tool call passes through. */
  readonly firewall?: ActionFirewall;
  readonly approvals?: ApprovalStore;
  readonly roleMap?: RolePermissionMap;
  readonly approvalExpiresInMs?: number;
  readonly dataPolicy?: DataPolicy;
}

export interface CreateCopilotOptions {
  /** The default model for every run (the server chooses; clients need not send one). */
  readonly model: ModelReference;
  /** Provider adapters (e.g. `createOpenAIProvider`), or a fully configured `modelRuntime`. */
  readonly providers?: readonly ModelProvider[];
  readonly modelRuntime?: ModelRuntime;
  readonly retry?: RetryPolicy;
  /** Backend tools, as definitions or an existing registry. */
  readonly tools?: readonly AnyToolDefinition[] | ToolRegistry;
  readonly security?: CopilotSecurityOptions;
  readonly telemetry?: TelemetryAdapter;
  readonly logger?: boolean;
  /** Escape hatch for any other `createServer` option. */
  readonly server?: Omit<Partial<CreateServerOptions>, 'runtime' | 'modelRuntime'>;
}

export interface CopilotRunInput {
  readonly messages: readonly ClientMessageInput[];
  readonly threadId?: string;
  /** Request headers for this run, e.g. `authorization`, passed to the authentication adapter. */
  readonly headers?: Readonly<Record<string, string>>;
  readonly signal?: AbortSignal;
}

export interface CopilotRunResult {
  readonly status: 'completed' | 'failed' | 'cancelled' | 'waiting_for_approval';
  /** Concatenated assistant text. */
  readonly text: string;
  readonly events: readonly CopilotEvent[];
  readonly usage?: Usage;
  readonly error?: PublicCopilotError;
}

export interface Copilot {
  /** The configured Fastify server: `listen()` it, or register more plugins on it. */
  readonly app: FastifyApp;
  /** The default model every run uses. */
  readonly model: ModelReference;
  /** The model runtime runs execute on (for example, for a connection test). */
  readonly modelRuntime: ModelRuntime;
  /** The backend tool registry, when tools were configured. */
  readonly toolRegistry?: ToolRegistry;
  /** True when an Action Firewall guards backend tool calls. */
  readonly firewallEnabled: boolean;
  /** An in-process `CopilotClient` that goes through the same HTTP pipeline (auth, firewall). */
  client(headers?: Readonly<Record<string, string>>): CopilotClient;
  /** Runs one turn and collects the result. */
  run(input: string | CopilotRunInput): Promise<CopilotRunResult>;
  /** Runs one turn and yields protocol events as they are produced. */
  stream(input: string | CopilotRunInput): AsyncIterable<CopilotEvent>;
  /** A `node:http` request listener (also mountable in Express/Connect). */
  nodeHandler(): (request: IncomingMessage, response: ServerResponse) => void;
  /**
   * A web-standard handler (`Request` → `Response`, streaming SSE) for Next.js App Router
   * route handlers, Remix, Hono, Bun or Deno. `basePath` is the URL prefix the copilot is
   * mounted under (for example `/api/copilot`); it is stripped before routing.
   */
  fetchHandler(options?: { readonly basePath?: string }): (request: Request) => Promise<Response>;
  listen(options?: { readonly host?: string; readonly port?: number }): Promise<string>;
  close(): Promise<void>;
}

const IN_PROCESS_BASE_URL = 'http://copilot.in-process';

/**
 * A `fetch` that dispatches into the Fastify app in-process (light-my-request), streaming the
 * response body. The run therefore takes exactly the same route, validation, authentication,
 * firewall and SSE path as a real HTTP request - there is no second execution path.
 */
function createInProcessFetch(app: FastifyApp): typeof fetch {
  return async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, key) => {
      headers[key] = value;
    });
    const method = (init?.method ?? 'GET').toUpperCase() as 'GET' | 'POST';
    const response = await app.inject({
      method,
      url: url.pathname + url.search,
      headers,
      payload: typeof init?.body === 'string' ? init.body : undefined,
      payloadAsStream: true,
      signal: init?.signal ?? undefined,
    });
    const body = Readable.toWeb(response.stream()) as ReadableStream<Uint8Array>;
    const responseHeaders = new Headers();
    for (const [key, value] of Object.entries(response.headers)) {
      if (value !== undefined) responseHeaders.set(key, Array.isArray(value) ? value.join(', ') : String(value));
    }
    return new Response(body, { status: response.statusCode, headers: responseHeaders });
  };
}

function toRunInput(input: string | CopilotRunInput): CopilotRunInput {
  return typeof input === 'string' ? { messages: [{ role: 'user', content: [{ type: 'text', text: input }] }] } : input;
}

/**
 * Creates a server-side copilot: one composition of the existing server, core runtime, model
 * runtime, tools and security - no React/Angular, no second runtime. Use `app` to serve HTTP
 * (Fastify), `nodeHandler()` for `node:http`/Express, or `run`/`stream` in-process (jobs,
 * scripts, tests).
 */
export function createCopilot(options: CreateCopilotOptions): Copilot {
  const modelRuntime =
    options.modelRuntime ??
    createModelRuntime({
      providers: [...(options.providers ?? [])],
      ...(options.retry ? { defaults: { retry: options.retry } } : {}),
    });
  const toolRegistry =
    options.tools === undefined
      ? undefined
      : 'register' in options.tools
        ? options.tools
        : (() => {
            const registry = createToolRegistry();
            for (const tool of options.tools) registry.register(tool);
            return registry;
          })();
  const security = options.security ?? {};
  const app = createServer({
    ...options.server,
    runtime: createRuntime({ executor: createModelExecutor({ runtime: modelRuntime, model: options.model }) }),
    modelRuntime,
    defaultModel: options.model,
    toolRegistry,
    telemetry: options.telemetry,
    logger: options.logger,
    authenticationAdapter: security.authentication,
    actionFirewall: security.firewall,
    approvals: security.approvals,
    roleMap: security.roleMap,
    approvalExpiresInMs: security.approvalExpiresInMs,
    dataPolicy: security.dataPolicy,
  });
  const fetchImpl = createInProcessFetch(app);
  const client = (headers: Readonly<Record<string, string>> = {}): CopilotClient =>
    createCopilotClient({ baseUrl: IN_PROCESS_BASE_URL, fetchImpl, getHeaders: () => ({ ...headers }) });

  async function* stream(raw: string | CopilotRunInput): AsyncIterable<CopilotEvent> {
    const input = toRunInput(raw);
    const handle = client(input.headers).run({ messages: input.messages, threadId: input.threadId, signal: input.signal });
    yield* handle.events;
  }

  return {
    app,
    model: options.model,
    modelRuntime,
    ...(toolRegistry ? { toolRegistry } : {}),
    firewallEnabled: security.firewall !== undefined,
    client,
    stream,
    async run(raw) {
      const events: CopilotEvent[] = [];
      let text = '';
      let usage: Usage | undefined;
      let error: PublicCopilotError | undefined;
      let status: CopilotRunResult['status'] = 'completed';
      for await (const event of stream(raw)) {
        events.push(event);
        if (event.type === 'message.delta') text += event.delta;
        else if (event.type === 'run.completed') {
          usage = event.usage;
          status = 'completed';
        } else if (event.type === 'run.failed' || event.type === 'error') {
          error = event.error;
          status = 'failed';
        } else if (event.type === 'run.cancelled') status = 'cancelled';
        else if (event.type === 'approval.requested') status = 'waiting_for_approval';
      }
      return { status, text, events, usage, error };
    },
    nodeHandler() {
      const ready = Promise.resolve(app.ready());
      return (request, response) => {
        ready.then(() => app.routing(request, response)).catch((failure: unknown) => {
          response.statusCode = 500;
          response.end();
          app.log.error(failure);
        });
      };
    },
    fetchHandler(handlerOptions = {}) {
      const basePath = (handlerOptions.basePath ?? '').replace(/\/+$/, '');
      return async (request) => {
        const url = new URL(request.url);
        if (basePath && url.pathname !== basePath && !url.pathname.startsWith(`${basePath}/`)) {
          return new Response(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Not found.' } }), { status: 404, headers: { 'content-type': 'application/json' } });
        }
        const path = url.pathname.slice(basePath.length) || '/';
        const body = request.method === 'GET' || request.method === 'HEAD' ? undefined : await request.text();
        return fetchImpl(`${IN_PROCESS_BASE_URL}${path}${url.search}`, { method: request.method, headers: request.headers, body, signal: request.signal });
      };
    },
    listen: (listenOptions = {}) => app.listen({ host: listenOptions.host ?? '127.0.0.1', port: listenOptions.port ?? 0 }),
    close: () => app.close(),
  };
}
