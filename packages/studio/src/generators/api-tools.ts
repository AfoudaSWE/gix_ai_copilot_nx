import type { ApiOperation, OperationConfidence } from '../discovery/model.js';
import type { PolicyProposal, ProposalItems, ProposalWarning, ToolProposal } from '../proposals/model.js';
import { GENERATED_ROOT, header, identifier, pascal, slug, str, zodFromJsonSchema } from './codegen.js';
import type { GeneratedDraft, Generator, GeneratorContext, GeneratorInput, RenderedFile } from './contract.js';
import { approvalFloor, suggestPermission, suggestRisk, toolNameFor } from './risk.js';

interface ApiToolsAnalysis {
  readonly operations: readonly { readonly operation: ApiOperation; readonly confidence: OperationConfidence; readonly conflicts: readonly string[] }[];
  readonly knownPermissions: readonly string[];
  readonly specFiles: Readonly<Record<string, string>>;
}

type Mode = 'api' | 'openapi';

function pathParams(path: string): string[] {
  return [...path.matchAll(/\{([^}]+)\}/g)].map((match) => match[1] ?? 'param');
}

/** Input schema for an operation without a declared one: path params, plus a body for writes. */
function inferredInputSchema(operation: ApiOperation): Record<string, unknown> {
  const params = pathParams(operation.path);
  const properties: Record<string, unknown> = Object.fromEntries(params.map((name) => [name, { type: 'string' }]));
  if (operation.method !== 'GET' && operation.method !== 'DELETE') properties['body'] = { type: 'object' };
  return { type: 'object', properties, required: params };
}

/** Policy candidates mirror their tools (§32 "Generate Policy Candidates", §39). */
export function policyForTool(tool: ToolProposal): PolicyProposal {
  return { id: `policy:${tool.id}`, selected: tool.selected, tool: tool.name, requiredPermissions: tool.permission ? [tool.permission] : [], approval: tool.approval, risk: tool.risk };
}

function groupBySource(tools: readonly ToolProposal[]): Map<string, ToolProposal[]> {
  const groups = new Map<string, ToolProposal[]>();
  for (const tool of tools) {
    const key = slug(tool.operation.source);
    groups.set(key, [...(groups.get(key) ?? []), tool]);
  }
  return groups;
}

function securityFile(name: string, tools: readonly ToolProposal[], generator: string): string {
  const constant = `${identifier(name)}Security`;
  const entries = tools.map((tool) => {
    const fields = [`risk: ${str(tool.risk)}`, `approval: ${str(tool.approval)}`, ...(tool.permission ? [`requiredPermissions: [${str(tool.permission)}]`] : [])];
    return `  ${str(tool.name)}: { ${fields.join(', ')} },`;
  });
  return `${header(generator, 'Reviewed security for these tools; the Action Firewall enforces it.')}import type { ToolSecurityManifest } from '@gixcopilot/protocol';

/** Risk, approval and permission per tool, as approved in the Studio. */
export const ${constant} = {
${entries.join('\n')}
} as const satisfies Readonly<Record<string, ToolSecurityManifest>>;
`;
}

function httpToolsFile(name: string, tools: readonly ToolProposal[]): string {
  const factory = `create${pascal(name)}Tools`;
  const security = `${identifier(name)}Security`;
  const definitions = tools.map((tool) => {
    const params = pathParams(tool.operation.path);
    const hasBody = tool.operation.method !== 'GET' && tool.operation.method !== 'DELETE';
    const paramObject = params.length > 0 ? `{ ${params.map((param) => `${str(param)}: input[${str(param)}]`).join(', ')} }` : '{}';
    const inputName = params.length > 0 || hasBody ? 'input' : '_input';
    return `    defineTool({
      name: ${str(tool.name)},
      description: ${str(tool.description)},
      input: ${zodFromJsonSchema(tool.inputSchema)},
      security: ${security}[${str(tool.name)}],
      enabled: ${String(tool.enabled)},
      metadata: { custom: { generatedBy: 'gix-studio', method: ${str(tool.operation.method)}, path: ${str(tool.operation.path)}, source: ${str(tool.operation.file)} } },
      execute: (${inputName}, context) => call(${str(tool.operation.method.toLowerCase())}, ${str(tool.operation.path)}, ${paramObject}, context${hasBody ? ', input.body' : ''}),
    }),`;
  });
  return `${header('API → Tools', `From ${[...new Set(tools.map((tool) => tool.operation.file))].join(', ')}.`)}import { createFetchHttpExecutor } from '@gixcopilot/openapi';
import type { HttpExecutor, HttpMethod } from '@gixcopilot/openapi';
import { defineTool } from '@gixcopilot/tools';
import type { AnyToolDefinition, ToolExecutionContext } from '@gixcopilot/tools';
import { z } from 'zod';
import { ${security} } from '../security/${name}.security.js';

export interface ${pascal(name)}ToolsOptions {
  /** Trusted API base URL from your configuration. Never taken from model input. */
  readonly baseUrl: string;
  /** Credentials for a call, derived from the trusted request context (never from the model). */
  readonly headers?: (context: ToolExecutionContext) => Readonly<Record<string, string>> | Promise<Readonly<Record<string, string>>>;
  /** Defaults to the SDK's SSRF-safe executor: escaped path values, pinned origin, bounded responses. */
  readonly http?: HttpExecutor;
}

/**
 * Tools for ${name}. Register the ones you want:
 *   for (const tool of ${factory}({ baseUrl })) registry.register(tool);
 * Every call still passes through the Action Firewall.
 */
export function ${factory}(options: ${pascal(name)}ToolsOptions): readonly AnyToolDefinition[] {
  const http = options.http ?? createFetchHttpExecutor();
  const call = async (method: HttpMethod, pathTemplate: string, pathParams: Readonly<Record<string, string>>, context: ToolExecutionContext, body?: unknown) => {
    const response = await http.execute({ method, baseUrl: options.baseUrl, pathTemplate, pathParams, headers: await options.headers?.(context), body, signal: context.signal });
    return { status: response.status, body: response.body };
  };
  return [
${definitions.join('\n')}
  ];
}
`;
}

function openApiToolsFile(name: string, tools: readonly ToolProposal[], specFile: string): string {
  const security = `${identifier(name)}Security`;
  const enabled = tools.filter((tool) => tool.enabled);
  const disabled = tools.filter((tool) => !tool.enabled);
  const depth = '../'.repeat(2);
  const overrides = enabled.map((tool) => `      ${str(tool.operation.key)}: { expose: true, name: ${str(tool.name)}, description: ${str(tool.description)}, ...${security}[${str(tool.name)}] },`);
  return `${header('OpenAPI → Tools', `From ${specFile}.`)}import { fileURLToPath } from 'node:url';
import { registerOpenAPI } from '@gixcopilot/openapi';
import type { OpenAPIIntegration, RegisterOpenAPIOptions } from '@gixcopilot/openapi';
import type { ToolRegistry } from '@gixcopilot/tools';
import { ${security} } from '../security/${name}.security.js';

export type ${pascal(name)}OpenAPIOptions = Omit<RegisterOpenAPIOptions, 'registry' | 'integrationId' | 'source' | 'include' | 'operations'>;

/**
 * Registers only the reviewed operations of ${specFile}. Anything not listed in \`include\`
 * is never exposed.${disabled.length > 0 ? `\n * Disabled in review (not exposed): ${disabled.map((tool) => tool.name).join(', ')}.` : ''}
 */
export function register${pascal(name)}Tools(registry: ToolRegistry, options: ${pascal(name)}OpenAPIOptions = {}): Promise<OpenAPIIntegration> {
  return registerOpenAPI({
    ...options,
    registry,
    integrationId: ${str(name)},
    source: { kind: 'file', path: fileURLToPath(new URL(${str(`${depth}${specFile}`)}, import.meta.url)) },
    include: [${enabled.map((tool) => str(tool.operation.key)).join(', ')}],
    operations: {
${overrides.join('\n')}
    },
  });
}
`;
}

function createApiToolsGenerator(mode: Mode): Generator<ApiToolsAnalysis> {
  const id = mode === 'openapi' ? 'openapi-tools' : 'api-tools';
  const title = mode === 'openapi' ? 'OpenAPI → Tools' : 'API → Tools';
  return {
    id,
    title,
    description: mode === 'openapi' ? 'Turns selected OpenAPI operations into reviewed tools registered through @gixcopilot/openapi.' : 'Turns discovered backend routes and API client calls into reviewed tools.',
    analyze(context: GeneratorContext, input: GeneratorInput) {
      // One candidate per normalized operation (§17): an operation described by OpenAPI belongs
      // to OpenAPI → Tools, everything else (Swagger, routes, Postman, client calls) to API → Tools.
      const normalized = context.discovery.operations.filter((operation) => (mode === 'openapi') === (operation.primary.sourceKind === 'openapi'));
      const chosen = input.select && input.select.length > 0 ? normalized.filter((operation) => input.select?.some((key) => key === operation.key || key === operation.primary.id || key === `${operation.method} ${operation.path}`)) : normalized;
      const selected = chosen.map((operation) => ({ operation: operation.primary, confidence: operation.confidence, conflicts: operation.conflicts }));
      const specFiles = Object.fromEntries(context.discovery.apis.filter((source) => source.kind === 'openapi').map((source) => [source.title ?? source.file, source.file]));
      return Promise.resolve({ operations: selected, knownPermissions: context.discovery.permissions.map((permission) => permission.name), specFiles });
    },
    generate(analysis) {
      const warnings: ProposalWarning[] = [];
      const names = new Set<string>();
      const tools = analysis.operations.map(({ operation, confidence, conflicts }, index): ToolProposal => {
        let name = toolNameFor(operation.method, operation.path);
        for (let suffix = 2; names.has(name); suffix += 1) name = `${toolNameFor(operation.method, operation.path)}${String(suffix)}`;
        names.add(name);
        const risk = suggestRisk(operation.method);
        const permission = suggestPermission(operation.method, operation.path, operation.permissions, analysis.knownPermissions);
        const toolId = `tool:${String(index)}:${name}`;
        if (confidence === 'review') warnings.push({ code: 'NEEDS_REVIEW', message: `${name}: ${conflicts.length > 0 ? conflicts.join(' ') : 'inferred only from client calls; confirm the contract'} It is not preselected.`, itemId: toolId });
        if (!permission.discovered) warnings.push({ code: 'PERMISSION_NOT_FOUND', message: `No permission for ${operation.method} ${operation.path} was found in the code; "${permission.permission}" is a suggested new name.`, itemId: toolId });
        if (!operation.input && operation.method !== 'GET' && operation.method !== 'DELETE') warnings.push({ code: 'INPUT_SCHEMA_PLACEHOLDER', message: `${name}: no request schema was discovered; the body is an open object. Tighten it before enabling.`, itemId: toolId });
        return {
          id: toolId,
          // Destructive and needs-review operations are proposed but never preselected (§26, §44).
          selected: risk !== 'destructive' && confidence !== 'review',
          confidence,
          ...(conflicts.length > 0 ? { conflicts } : {}),
          name,
          description: operation.summary ?? `${operation.method} ${operation.path} (${operation.source})`,
          operation: { method: operation.method, path: operation.path, source: operation.source, file: operation.file, key: operation.sourceKind === 'openapi' ? (operation.operationId ?? `${operation.method} ${operation.path}`) : operation.id },
          suggestedRisk: risk,
          risk,
          permission: permission.permission,
          approval: approvalFloor(risk),
          enabled: risk !== 'destructive',
          inputSchema: operation.input ?? inferredInputSchema(operation),
        };
      });
      const draft: GeneratedDraft = {
        title: `${title}: ${String(tools.length)} tool candidate(s)`,
        warnings,
        tools,
        policies: tools.map(policyForTool),
        context: [],
        ui: [],
        agents: [],
        skills: [],
        knowledge: [],
        configChanges: [],
        integrations: [],
      };
      return Promise.resolve(draft);
    },
    render(items: ProposalItems) {
      const files: RenderedFile[] = [];
      for (const [name, group] of groupBySource(items.tools.filter((tool) => tool.selected))) {
        const itemIds = group.map((tool) => tool.id);
        files.push({ path: `${GENERATED_ROOT}/security/${name}.security.ts`, content: securityFile(name, group, title), itemIds });
        if (mode === 'openapi') {
          const spec = group[0]?.operation.file ?? '';
          files.push({ path: `${GENERATED_ROOT}/tools/${name}.openapi.ts`, content: openApiToolsFile(name, group, spec), itemIds });
        } else {
          files.push({ path: `${GENERATED_ROOT}/tools/${name}.ts`, content: httpToolsFile(name, group), itemIds });
        }
      }
      return Promise.resolve(files);
    },
    validate(items) {
      return items.tools
        .filter((tool) => tool.selected && tool.enabled && tool.risk === 'destructive')
        .map((tool) => ({ code: 'DESTRUCTIVE_ENABLED', message: `${tool.name} is destructive and enabled; it will require ${tool.approval} approval on every call.`, itemId: tool.id }));
    },
  };
}

export const apiToolsGenerator = createApiToolsGenerator('api');
export const openApiToolsGenerator = createApiToolsGenerator('openapi');
