import { redactCredentialValues } from '@gixcopilot/tools';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { McpConnectionState, McpToolCandidate, McpTransportConfig } from './types.js';

export type { McpToolCandidate } from './types.js';

/**
 * A normalized MCP content block (Section 73). `image`/`audio`/`resource` blocks deliberately
 * drop the raw base64 payload here, keeping only metadata (mimeType/uri) - mirrors
 * `@gixcopilot/openapi`'s HTTP response header allowlisting (Section 31/58's "avoid sending
 * massive payloads to the model by default"); a caller that genuinely needs the raw bytes can
 * fetch the resource explicitly via `readResource`.
 */
export type McpContentBlock =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'image'; readonly mimeType: string }
  | { readonly type: 'audio'; readonly mimeType: string }
  | { readonly type: 'resource'; readonly uri: string; readonly mimeType?: string }
  | { readonly type: 'resource_link'; readonly uri: string; readonly name: string }
  | { readonly type: 'unknown' };

export interface McpCallResult {
  readonly isError: boolean;
  readonly content: readonly McpContentBlock[];
  readonly structuredContent?: Readonly<Record<string, unknown>>;
}

export interface McpResource {
  readonly uri: string;
  readonly name: string;
  readonly description?: string;
  readonly mimeType?: string;
}

export interface McpResourceContent {
  readonly uri: string;
  readonly mimeType?: string;
  readonly text?: string;
}

export interface McpPrompt {
  readonly name: string;
  readonly description?: string;
}

export interface McpCallOptions {
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}

/**
 * Project-owned MCP client contract (Section 69) - every method returns this package's own
 * plain types, never a type from `@modelcontextprotocol/sdk`, so the SDK stays an internal
 * implementation detail `client.ts` alone depends on directly.
 */
export interface McpClient {
  readonly serverId: string;
  readonly state: McpConnectionState;
  subscribeState?(listener: (state: McpConnectionState) => void): () => void;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  listTools(): Promise<readonly McpToolCandidate[]>;
  callTool(name: string, args: Readonly<Record<string, unknown>>, options?: McpCallOptions): Promise<McpCallResult>;
  listResources(): Promise<readonly McpResource[]>;
  readResource(uri: string): Promise<McpResourceContent>;
  listPrompts(): Promise<readonly McpPrompt[]>;
}

export interface CreateMcpClientOptions {
  readonly serverId: string;
  readonly transport: McpTransportConfig;
  /** Merged into the transport's outgoing requests for `streamableHttp` (Section 81's
   * server-side-only credential injection) - never applicable to `stdio` (use `env` instead). */
  readonly requestHeaders?: Readonly<Record<string, string>>;
  readonly timeoutMs?: number;
  readonly onStateChange?: (state: McpConnectionState) => void;
}

function buildTransport(config: McpTransportConfig, requestHeaders: Readonly<Record<string, string>> | undefined): Transport {
  switch (config.kind) {
    case 'stdio':
      return new StdioClientTransport({
        command: config.command,
        args: config.args ? [...config.args] : undefined,
        env: config.env ? { ...config.env } : undefined,
        cwd: config.cwd,
        stderr: 'ignore',
      });
    case 'streamableHttp':
      if (!/^https?:$/.test(new URL(config.url).protocol) || new URL(config.url).username || new URL(config.url).password) throw new Error('Invalid MCP server URL.');
      return new StreamableHTTPClientTransport(
        new URL(config.url),
        { requestInit: { headers: requestHeaders, redirect: 'error' } },
      );
  }
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' ? value : undefined;
}

function toContentBlock(block: unknown): McpContentBlock {
  if (typeof block !== 'object' || block === null) return { type: 'unknown' };
  const record = block as Record<string, unknown>;
  switch (record['type']) {
    case 'text': {
      const text = stringField(record, 'text');
      return text !== undefined ? { type: 'text', text } : { type: 'unknown' };
    }
    case 'image':
      return { type: 'image', mimeType: stringField(record, 'mimeType') ?? 'application/octet-stream' };
    case 'audio':
      return { type: 'audio', mimeType: stringField(record, 'mimeType') ?? 'application/octet-stream' };
    case 'resource': {
      const resource = record['resource'];
      const resourceRecord = typeof resource === 'object' && resource !== null ? (resource as Record<string, unknown>) : {};
      return { type: 'resource', uri: stringField(resourceRecord, 'uri') ?? '', mimeType: stringField(resourceRecord, 'mimeType') };
    }
    case 'resource_link':
      return { type: 'resource_link', uri: stringField(record, 'uri') ?? '', name: stringField(record, 'name') ?? '' };
    default:
      return { type: 'unknown' };
  }
}

/**
 * Creates a project-owned MCP client for one server. Connection lifecycle (Section 72) is
 * modeled explicitly: `disconnected -> connecting -> connected`, with `error` reachable from
 * any state on a transport failure and `closing` entered only during an explicit
 * `disconnect()`. Every discovery/execution method throws if called before `connect()` has
 * resolved - there is no implicit lazy-connect, so a caller always knows the connection state
 * it is operating under.
 */
export function createMcpClient(options: CreateMcpClientOptions): McpClient {
  return createMcpClientFromTransportFactory(
    options.serverId,
    () => buildTransport(options.transport, options.requestHeaders),
    options.onStateChange,
    options.timeoutMs,
    options.requestHeaders,
  );
}

/**
 * @internal Exposed only so this package's own tests (`test-server.ts`) can attach an
 * `InMemoryTransport` for a real, in-process MCP server - a test-only concept with no
 * `McpTransportConfig` variant of its own (Section 71 forbids inventing transport names in the
 * public config type). Not re-exported from `index.ts`.
 */
export function createMcpClientFromTransportFactory(
  serverId: string,
  transportFactory: () => Transport,
  onStateChange?: (state: McpConnectionState) => void,
  timeoutMs = 30_000,
  credentialHeaders: Readonly<Record<string, string>> = {},
): McpClient {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('MCP timeout must be positive and finite.');
  const listeners = new Set<(state: McpConnectionState) => void>();
  let connecting: Promise<void> | undefined;
  let state: McpConnectionState = 'disconnected';
  let sdkClient: Client | undefined;

  function setState(next: McpConnectionState): void {
    if (state === next) return;
    state = next;
    for (const listener of listeners) { try { listener(next); } catch { /* Observers cannot change lifecycle. */ } }
    try { onStateChange?.(next); } catch { /* Observers cannot change lifecycle. */ }
  }

  function requireClient(): Client {
    if (!sdkClient || state !== 'connected') throw new Error(`MCP client "${serverId}" is not connected.`);
    return sdkClient;
  }

  return {
    serverId,
    get state() {
      return state;
    },

    subscribeState(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },

    async connect() {
      if (state === 'connected') return;
      if (connecting) return connecting;
      setState('connecting');
      connecting = (async () => {
        const previous = sdkClient;
        sdkClient = undefined;
        await previous?.close();
        const next = new Client({ name: `gixcopilot-mcp-${serverId}`, version: '1.0.0' }, { capabilities: {} });
        sdkClient = next;
        next.onclose = () => { if (sdkClient === next) { sdkClient = undefined; setState('disconnected'); } };
        next.onerror = () => { if (sdkClient === next) setState('error'); };
        try {
          await next.connect(transportFactory(), { timeout: timeoutMs });
          if (sdkClient !== next) throw new Error('MCP connection closed during initialization.');
          setState('connected');
        } catch (error) {
          if (sdkClient === next) sdkClient = undefined;
          await next.close().catch(() => {});
          setState('error');
          throw error;
        }
      })();
      try { await connecting; } finally { connecting = undefined; }
    },

    async disconnect() {
      if (!sdkClient) {
        setState('disconnected');
        return;
      }
      setState('closing');
      const current = sdkClient;
      sdkClient = undefined;
      try { await current.close(); } finally { setState('disconnected'); }
    },

    async listTools() {
      const current = requireClient();
      const tools = [];
      let cursor: string | undefined;
      const seen = new Set<string>();
      do {
        const result = await current.listTools({ cursor }, { timeout: timeoutMs });
        tools.push(...result.tools);
        cursor = result.nextCursor;
        if (cursor && seen.has(cursor)) throw new Error('Repeated MCP discovery cursor.');
        if (cursor) seen.add(cursor);
        if (seen.size > 100) throw new Error('MCP discovery page limit exceeded.');
      } while (cursor);
      return tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      }));
    },

    async callTool(name, args, callOptions) {
      const raw = await requireClient().callTool(
        { name, arguments: args },
        undefined,
        { signal: callOptions?.signal, timeout: callOptions?.timeoutMs ?? timeoutMs },
      );
      const result = raw as { content?: unknown; isError?: unknown; structuredContent?: Readonly<Record<string, unknown>> };
      if (!Array.isArray(result.content)) {
        return { isError: false, content: [] };
      }
      return {
        isError: result.isError === true,
        content: redactCredentialValues(result.content.map(toContentBlock), credentialHeaders) as McpContentBlock[],
        structuredContent: redactCredentialValues(result.structuredContent, credentialHeaders) as Readonly<Record<string, unknown>> | undefined,
      };
    },

    // A server that registers no resources/prompts never advertises that capability at all
    // (Section 86's "where supported") - listing is a graceful `[]` in that case, not a wire
    // round-trip guaranteed to come back "Method not found".
    async listResources() {
      const current = requireClient();
      if (!current.getServerCapabilities()?.resources) return [];
      const result = await current.listResources({}, { timeout: timeoutMs });
      return result.resources.map((resource) => ({
        uri: resource.uri,
        name: resource.name,
        description: resource.description,
        mimeType: resource.mimeType,
      }));
    },

    async readResource(uri) {
      const result = await requireClient().readResource({ uri }, { timeout: timeoutMs });
      const first = result.contents[0];
      if (!first) return { uri };
      return { uri: first.uri, mimeType: first.mimeType, text: 'text' in first ? first.text : undefined };
    },

    async listPrompts() {
      const current = requireClient();
      if (!current.getServerCapabilities()?.prompts) return [];
      const result = await current.listPrompts({}, { timeout: timeoutMs });
      return result.prompts.map((prompt) => ({ name: prompt.name, description: prompt.description }));
    },
  };
}
