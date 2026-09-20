import { measureIntegration } from '@gixcopilot/tools';
import type { AnyToolDefinition, ToolRegistration, ToolRegistry } from '@gixcopilot/tools';
import { createMcpClient } from './client.js';
import type { McpClient, McpPrompt, McpResource, McpResourceContent } from './client.js';
import { generateMcpTools } from './tool-generator.js';
import type { GenerateMcpToolsOptions } from './tool-generator.js';
import type { McpConnectionState, McpGenerationReport, McpToolSourceMetadata, RegistrationConflict, McpTransportConfig } from './types.js';

export interface ReconnectPolicy {
  /** Total connection attempts including the first, e.g. `3` = up to 2 retries. Defaults to
   * `1` (no automatic reconnect) - matches Section 85's "avoid infinite reconnect loops" and
   * this phase's overall "opt-in, conservative default" convention. */
  readonly maxAttempts?: number;
  readonly baseDelayMs?: number;
}

export interface RegisterMCPOptions extends Omit<GenerateMcpToolsOptions, 'client'> {
  readonly serverId: string;
  readonly transport: McpTransportConfig;
  /** Merged into outgoing requests for `streamableHttp` (Section 81's server-side-only
   * credential injection). */
  readonly requestHeaders?: Readonly<Record<string, string>>;
  readonly registry: ToolRegistry;
  /** Supplies an already-constructed client instead of building one from `transport` - mainly
   * for tests (see `test-server.ts`'s `InMemoryTransport`) and advanced use. */
  readonly client?: McpClient;
  readonly reconnect?: ReconnectPolicy;
  readonly onStateChange?: (state: McpConnectionState) => void;
}

export interface MCPIntegration {
  readonly serverId: string;
  readonly connectionState: McpConnectionState;
  readonly report: McpGenerationReport;
  readonly toolNames: readonly string[];
  /** Re-connects (with bounded backoff, Section 85) if the connection has dropped, then
   * re-discovers tools and reconciles them against the registry exactly like
   * `@gixcopilot/openapi`'s `refresh()`: a tool still present is updated in place, a tool that
   * disappeared is unregistered, a newly-appeared tool is registered. */
  refresh(): Promise<McpGenerationReport>;
  listResources(): Promise<readonly McpResource[]>;
  readResource(uri: string): Promise<McpResourceContent>;
  /**
   * Untrusted external content (Section 88-89): an MCP prompt's text comes from the remote
   * server, exactly like a tool result's content, and must never be treated as trusted system/
   * security configuration. A prompt that says "ignore your Action Firewall" has no special
   * status here - this method returns plain data, the same way `readResource` does; nothing in
   * this SDK feeds a returned prompt into system-prompt construction or policy evaluation
   * automatically, and a caller that does so is responsible for keeping that boundary.
   */
  listPrompts(): Promise<readonly McpPrompt[]>;
  /** Disconnects the client and unregisters every tool this integration owns. Idempotent. */
  dispose(): Promise<void>;
}

function messageOf(_error: unknown): string {
  return 'MCP connection or discovery failed. Check server-side configuration.';
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function connectWithBackoff(client: McpClient, policy: ReconnectPolicy): Promise<void> {
  const maxAttempts = policy.maxAttempts ?? 1;
  const baseDelayMs = policy.baseDelayMs ?? 500;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 10 || !Number.isFinite(baseDelayMs) || baseDelayMs < 0 || baseDelayMs > 30_000) throw new Error('Invalid bounded MCP reconnect policy.');
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await client.connect();
      return;
    } catch (error) {
      lastError = error;
      if (attempt < maxAttempts) await delay(baseDelayMs * 2 ** (attempt - 1));
    }
  }
  throw lastError;
}

function operationDescriptorOf(tool: AnyToolDefinition): string {
  const custom = tool.metadata?.custom as Partial<McpToolSourceMetadata> | undefined;
  return custom?.toolName !== undefined ? custom.toolName : tool.name;
}

function emptyReport(serverId: string, message: string): McpGenerationReport {
  return {
    serverId,
    connectionIssue: { message },
    toolsDiscovered: 0,
    generated: 0,
    skipped: 0,
    denied: 0,
    unsupported: 0,
    warnings: [],
    conflicts: [],
  };
}

/**
 * Connects to an MCP server, generates tools from its discovered tool list, and registers them
 * into `registry` (Section 5's "register into the EXISTING Tool Registry", mirrors
 * `@gixcopilot/openapi`'s `registerOpenAPI`). A tool name already registered by something else
 * is never silently overwritten - the registry's own `register()` rejects the duplicate, and
 * that rejection becomes an additional `conflicts` entry.
 */
export async function registerMCP(options: RegisterMCPOptions): Promise<MCPIntegration> {
  const { registry, client: providedClient, reconnect, onStateChange, serverId, transport, requestHeaders, ...generateOptions } = options;
  const client =
    providedClient ?? createMcpClient({ serverId, transport, requestHeaders, onStateChange, timeoutMs: options.timeoutMs });
  const registrations = new Map<string, ToolRegistration>();
  let disposed = false;
  function clearRegistrations(): void {
    for (const registration of registrations.values()) registration.dispose();
    registrations.clear();
  }
  const unsubscribe = client.subscribeState?.((state) => {
    if (state !== 'connected' && state !== 'connecting') clearRegistrations();
  });

  async function generateAndReconcile(): Promise<McpGenerationReport> {
    if (client.state !== 'connected') {
      try {
        await measureIntegration(options.onTelemetry, { stage: 'connect', integrationId: serverId }, () => connectWithBackoff(client, reconnect ?? {}));
      } catch (error) {
        for (const registration of registrations.values()) registration.dispose();
        registrations.clear();
        return emptyReport(serverId, messageOf(error));
      }
    }

    const { tools, report } = await generateMcpTools({ ...generateOptions, client });
    if (disposed || client.state !== 'connected') return emptyReport(serverId, 'Integration disconnected or disposed during discovery.');
    const nextNames = new Set(tools.map((tool) => tool.name));

    for (const [name, registration] of registrations) {
      if (!nextNames.has(name)) {
        registration.dispose();
        registrations.delete(name);
      }
    }

    const extraConflicts: RegistrationConflict[] = [];
    let registeredCount = 0;
    for (const tool of tools) {
      const existing = registrations.get(tool.name);
      if (existing) {
        existing.update(tool);
        registeredCount += 1;
        continue;
      }
      try {
        registrations.set(tool.name, registry.register(tool));
        registeredCount += 1;
      } catch {
        extraConflicts.push({ name: tool.name, operations: [operationDescriptorOf(tool)] });
      }
    }

    return { ...report, generated: registeredCount, conflicts: [...report.conflicts, ...extraConflicts] };
  }

  const reconcile = () => measureIntegration(options.onTelemetry, { stage: 'register', integrationId: serverId }, generateAndReconcile);
  let pending = Promise.resolve();
  let currentReport = await reconcile();

  return {
    serverId,
    get connectionState() {
      return client.state;
    },
    get report() {
      return currentReport;
    },
    get toolNames() {
      return Array.from(registrations.keys());
    },
    async refresh() {
      if (disposed) throw new Error('MCP integration is disposed.');
      const task = pending.then(async () => {
        if (disposed) throw new Error('Integration is disposed.');
        currentReport = await reconcile();
        return currentReport;
      });
      pending = task.then(() => {}, () => {});
      return task;
    },
    listResources: () => client.listResources(),
    readResource: (uri) => client.readResource(uri),
    listPrompts: () => client.listPrompts(),
    async dispose() {
      disposed = true;
      unsubscribe?.();
      for (const registration of registrations.values()) registration.dispose();
      registrations.clear();
      await client.disconnect();
    },
  };
}
