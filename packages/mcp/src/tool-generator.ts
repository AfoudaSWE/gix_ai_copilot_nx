import { measureIntegration } from '@gixcopilot/tools';
import type { IntegrationTelemetryObserver } from '@gixcopilot/tools';
import type { AnyToolDefinition, ToolExecutionContext } from '@gixcopilot/tools';
import type { z } from 'zod';
import type { McpCallResult, McpClient, McpToolCandidate } from './client.js';
import { normalizeMcpError, normalizeMcpToolFailure } from './error-normalization.js';
import { buildMcpInputSchema } from './input-schema.js';
import { deriveMcpToolName, detectNamingConflicts } from './naming.js';
import { buildMcpSecurityMetadata, resolveMcpToolExposure } from './security-policy.js';
import type { McpExposurePolicyOptions, McpSecurityMetadataOptions } from './security-policy.js';
import type { McpGenerationReport, McpServerTrustLevel, McpToolSourceMetadata, RegistrationWarning } from './types.js';

const DEFAULT_TIMEOUT_MS = 30_000;

export interface McpToolResult {
  readonly isError: boolean;
  readonly content: McpCallResult['content'];
  readonly structuredContent?: Readonly<Record<string, unknown>>;
}

export interface GenerateMcpToolsOptions extends McpExposurePolicyOptions {
  readonly onTelemetry?: IntegrationTelemetryObserver;
  readonly client: McpClient;
  readonly defaultPermission?: McpSecurityMetadataOptions['defaultPermission'];
  readonly timeoutMs?: number;
  readonly serverTrustLevel?: McpServerTrustLevel;
  /** Post-processes a tool's result before it is returned (mirrors
   * `@gixcopilot/openapi`'s `transformResult`) - Phase 7's data policy still applies
   * afterward, uniformly, in the server's dispatch pipeline. */
  readonly transformResult?: (result: McpToolResult, toolName: string) => unknown;
}

export interface GenerateMcpToolsResult {
  readonly tools: readonly AnyToolDefinition[];
  readonly report: McpGenerationReport;
}

function emptyReport(serverId: string, message: string, toolsDiscovered = 0): McpGenerationReport {
  return {
    serverId,
    connectionIssue: { message },
    toolsDiscovered,
    generated: 0,
    skipped: 0,
    denied: 0,
    unsupported: 0,
    warnings: [],
    conflicts: [],
  };
}

function messageOf(_error: unknown): string {
  return 'MCP connection or discovery failed. Check server-side configuration.';
}

interface BuildToolParams {
  readonly onTelemetry?: IntegrationTelemetryObserver;
  readonly name: string;
  readonly description: string;
  readonly schema: z.ZodType;
  readonly candidate: McpToolCandidate;
  readonly security: ReturnType<typeof buildMcpSecurityMetadata>;
  readonly client: McpClient;
  readonly serverTrustLevel?: McpServerTrustLevel;
  readonly timeoutMs: number;
  readonly transformResult?: (result: McpToolResult, toolName: string) => unknown;
}

function buildToolDefinition(params: BuildToolParams): AnyToolDefinition {
  const { name, description, schema, candidate, security, client, serverTrustLevel, timeoutMs, transformResult } = params;

  const sourceMetadata: McpToolSourceMetadata = {
    sourceType: 'mcp',
    serverId: client.serverId,
    toolName: candidate.name,
    serverTrustLevel,
  };

  return {
    name,
    description,
    inputSchema: schema,
    security,
    metadata: {
      source: 'mcp',
      executionLocation: 'server',
      custom: { ...sourceMetadata },
    },
    async execute(input: unknown, context: ToolExecutionContext): Promise<unknown> {
      const errorContext = { serverId: client.serverId, toolName: candidate.name };
      try {
        const result = await measureIntegration(params.onTelemetry, { stage: 'execute', integrationId: client.serverId, toolName: name }, () => client.callTool(candidate.name, input as Readonly<Record<string, unknown>>, {
          signal: context.signal,
          timeoutMs,
        }));
        if (result.isError) {
          const textSummary = result.content.find((block) => block.type === 'text')?.text ?? 'The tool reported an error.';
          throw normalizeMcpToolFailure(textSummary, errorContext);
        }
        const normalized: McpToolResult = {
          isError: result.isError,
          content: result.content,
          structuredContent: result.structuredContent,
        };
        return transformResult ? transformResult(normalized, candidate.name) : normalized;
      } catch (error) {
        throw normalizeMcpError(error, errorContext);
      }
    },
  };
}

/**
 * The full MCP generation pipeline (Section 67's mission, mirroring
 * `@gixcopilot/openapi`'s `generateOpenAPITools`): Connected Server -> Tool Discovery ->
 * Exposure Policy -> Schema Conversion -> `ToolDefinition`s + `McpGenerationReport`. Ensures
 * the client is connected (connecting it if necessary) rather than requiring the caller to
 * manage that separately - a connection failure becomes a `connectionIssue`-populated report
 * with zero tools, never a thrown error, mirroring `@gixcopilot/openapi`'s `documentIssues`.
 */
async function generate(options: GenerateMcpToolsOptions): Promise<GenerateMcpToolsResult> {
  const { client } = options;

  if (client.state !== 'connected') {
    try {
      await measureIntegration(options.onTelemetry, { stage: 'connect', integrationId: client.serverId }, () => client.connect());
    } catch (error) {
      return { tools: [], report: emptyReport(client.serverId, messageOf(error)) };
    }
  }

  let candidates: readonly McpToolCandidate[];
  try {
    candidates = await measureIntegration(options.onTelemetry, { stage: 'discover', integrationId: client.serverId }, () => client.listTools());
  } catch (error) {
    return { tools: [], report: emptyReport(client.serverId, messageOf(error)) };
  }

  const decisions = candidates.map((candidate) => ({
    candidate,
    decision: resolveMcpToolExposure(candidate.name, {
      defaultExposure: options.defaultExposure,
      include: options.include,
      exclude: options.exclude,
      tools: options.tools,
    }),
  }));

  const exposed = decisions.filter((entry) => entry.decision.exposure !== 'deny');
  const denied = decisions.length - exposed.length;

  const named = exposed.map((entry) => ({
    ...entry,
    name: deriveMcpToolName(client.serverId, entry.candidate.name, entry.decision.override?.name),
  }));

  const conflicts = detectNamingConflicts(named.map((entry) => ({ name: entry.name, operation: entry.candidate.name })));
  const conflictingNames = new Set(conflicts.map((conflict) => conflict.name));

  const tools: AnyToolDefinition[] = [];
  const warnings: RegistrationWarning[] = [];
  let generated = 0;
  let skipped = 0;
  let unsupported = 0;

  for (const entry of named) {
    if (conflictingNames.has(entry.name)) {
      skipped += 1;
      continue;
    }

    const schemaResult = buildMcpInputSchema(entry.candidate.inputSchema);
    if (!schemaResult.ok) {
      unsupported += 1;
      warnings.push({
        operation: entry.candidate.name,
        message: schemaResult.issues.map((issue) => `${issue.path}: ${issue.reason}`).join('; '),
      });
      continue;
    }

    const security = buildMcpSecurityMetadata(entry.candidate.name, entry.decision, {
      serverId: client.serverId,
      defaultPermission: options.defaultPermission,
    });

    tools.push(
      buildToolDefinition({
        onTelemetry: options.onTelemetry,
        name: entry.name,
        description: (entry.decision.override?.description ?? entry.candidate.description ?? entry.candidate.name).slice(0, 500),
        schema: schemaResult.schema,
        candidate: entry.candidate,
        security,
        client,
        serverTrustLevel: options.serverTrustLevel,
        timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        transformResult: options.transformResult,
      }),
    );
    generated += 1;
  }

  return {
    tools,
    report: {
      serverId: client.serverId,
      toolsDiscovered: candidates.length,
      generated,
      skipped,
      denied,
      unsupported,
      warnings,
      conflicts,
    },
  };
}

export function generateMcpTools(options: GenerateMcpToolsOptions): Promise<GenerateMcpToolsResult> {
  return measureIntegration(options.onTelemetry, { stage: 'generate', integrationId: options.client.serverId }, () => generate(options));
}
