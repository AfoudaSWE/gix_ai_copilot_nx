import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { CopilotError } from '@gixcopilot/protocol';
import type { ToolActionRisk, ToolApprovalLevel, ToolSecurityManifest } from '@gixcopilot/protocol';
import { createFetchHttpExecutor, normalizeExecutionError, normalizeHttpError, withRetry } from '@gixcopilot/openapi';
import type { HttpExecutor, RetryPolicy } from '@gixcopilot/openapi';
import {
  assertValidToolName,
  credentialsToHeaders,
  measureIntegration,
  noCredentialsProvider,
  redactCredentialValues,
} from '@gixcopilot/tools';
import type { AnyToolDefinition, CredentialProvider, IntegrationTelemetryObserver, ToolExecutionContext, ToolRegistry } from '@gixcopilot/tools';

export type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete';
export type ParamLocation = 'path' | 'query' | 'header' | 'body';

/** One endpoint of any HTTP API (REST, RPC-over-HTTP, legacy JSON or form APIs) in any language. */
export interface HttpEndpoint {
  readonly method: HttpMethod;
  /** Path relative to `baseUrl`, with `{name}` placeholders filled from input fields. */
  readonly path: string;
  /** What the tool does, for the model. Required: the model chooses tools from descriptions. */
  readonly description: string;
  /** Zod object schema for the tool input. Never include credentials here. */
  readonly input?: z.ZodObject;
  /** Optional schema for the response body; responses that do not match are rejected. */
  readonly output?: z.ZodType;
  /**
   * Where each input field goes. Defaults: `{placeholders}` → path; other fields → query for
   * GET/DELETE and JSON body for POST/PUT/PATCH.
   */
  readonly params?: Readonly<Record<string, ParamLocation>>;
  /** `'form'` sends body fields as `application/x-www-form-urlencoded`. Default `'json'`. */
  readonly bodyEncoding?: 'json' | 'form';
  /** Defaults by method: GET read-only, DELETE destructive, other methods write. */
  readonly risk?: ToolActionRisk;
  readonly approval?: ToolApprovalLevel;
  /** Defaults to the API's `defaultPermission` (`api.<id>`). */
  readonly requiredPermissions?: readonly string[];
  /** Fixed, non-secret headers for this endpoint (e.g. `Accept`). */
  readonly headers?: Readonly<Record<string, string>>;
  readonly timeoutMs?: number;
  /** `false` keeps the endpoint defined but not exposed as a tool. Default `true`. */
  readonly enabled?: boolean;
}

/** One GraphQL operation, sent as `POST { query, variables }` to the API's GraphQL path. */
export interface GraphQLOperation {
  readonly description: string;
  /** The GraphQL document. Fixed by the developer; the model only supplies variables. */
  readonly query: string;
  readonly variables?: z.ZodObject;
  readonly output?: z.ZodType;
  /** Defaults to read-only for `query` documents and write for `mutation`s. */
  readonly risk?: ToolActionRisk;
  readonly approval?: ToolApprovalLevel;
  readonly requiredPermissions?: readonly string[];
  readonly enabled?: boolean;
}

export interface HttpApiConfig {
  /** Integration id (letters, digits, `-`, `_`); also the default tool namespace. */
  readonly id: string;
  /** Configured by the developer (environment, config), never taken from model input. */
  readonly baseUrl: string;
  readonly description?: string;
  /** Tool name prefix. Defaults to `id`, so `customers.get` becomes `crm.customers.get`. */
  readonly namespace?: string;
  /** Resolved server-side on every call; credentials never reach the model or the logs. */
  readonly credentials?: CredentialProvider;
  /** Permission every tool requires unless it declares its own. Default `api.<id>`. */
  readonly defaultPermission?: string;
  /** Fixed, non-secret headers for every request. */
  readonly headers?: Readonly<Record<string, string>>;
  readonly timeoutMs?: number;
  /** Retries are opt-in; writes are only retried when an idempotency header is configured. */
  readonly retry?: RetryPolicy;
  /** Header that carries a generated idempotency key on writes, if the API supports one. */
  readonly idempotencyKeyHeader?: string;
  readonly endpoints?: Readonly<Record<string, HttpEndpoint>>;
  readonly graphql?: { readonly path?: string; readonly operations: Readonly<Record<string, GraphQLOperation>> };
  /** Response size limit in bytes (default 1 MiB). */
  readonly maxResponseBytes?: number;
  readonly httpExecutor?: HttpExecutor;
  readonly onTelemetry?: IntegrationTelemetryObserver;
}

export interface HttpApiToolResult {
  readonly status: number;
  readonly body: unknown;
}

export interface HttpApi {
  readonly id: string;
  readonly baseUrl: string;
  readonly tools: readonly AnyToolDefinition[];
  /** Registers every enabled tool; returns a function that unregisters them again. */
  register(registry: ToolRegistry): () => void;
}

const ID_PATTERN = /^[a-z][a-z0-9_-]*$/i;
const PLACEHOLDER = /\{([^}]+)\}/g;
const DEFAULT_TIMEOUT_MS = 30_000;
const METHOD_RISK: Readonly<Record<HttpMethod, ToolActionRisk>> = { get: 'read-only', post: 'write', put: 'write', patch: 'write', delete: 'destructive' };

export function placeholdersOf(path: string): string[] {
  return [...path.matchAll(PLACEHOLDER)].map((match) => match[1] ?? '');
}

function toParam(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? String(value) : JSON.stringify(value);
}

function describeMethod(method: HttpMethod, path: string): string {
  return `${method.toUpperCase()} ${path}`;
}

interface CallPlan {
  readonly method: HttpMethod;
  readonly path: string;
  readonly pathParams: Record<string, string>;
  readonly queryParams: Record<string, string | string[]>;
  readonly headers: Record<string, string>;
  readonly body: unknown;
  readonly bodyEncoding: 'json' | 'form';
  readonly timeoutMs: number;
  readonly output?: z.ZodType;
}

/**
 * Connects any HTTP API (any language or framework, no OpenAPI document needed) and turns
 * each declared endpoint or GraphQL operation into a canonical, schema-validated tool. The
 * tools execute through the hardened HTTP executor shared with `@gixcopilot/openapi` (the
 * request URL is built only from `baseUrl` plus encoded parameters, redirects are refused,
 * responses are size-limited and only safe headers are kept), and they pass the Action
 * Firewall exactly like hand-written tools. Only endpoints you declare exist: nothing is
 * discovered or exposed automatically.
 */
export function defineHttpApi(config: HttpApiConfig): HttpApi {
  if (!ID_PATTERN.test(config.id)) throw new Error(`Invalid API id "${config.id}": use letters, digits, "-" or "_".`);
  let base: URL;
  try {
    base = new URL(config.baseUrl);
  } catch {
    throw new Error(`API "${config.id}": baseUrl "${config.baseUrl}" is not a valid URL.`);
  }
  if (base.protocol !== 'http:' && base.protocol !== 'https:') throw new Error(`API "${config.id}": baseUrl must use http or https.`);
  const namespace = config.namespace ?? config.id;
  const executor = config.httpExecutor ?? createFetchHttpExecutor({ maxResponseBytes: config.maxResponseBytes });
  const credentialProvider = config.credentials ?? noCredentialsProvider();
  const permission = config.defaultPermission ?? `api.${config.id}`;
  const tools: AnyToolDefinition[] = [];

  function security(risk: ToolActionRisk, approval: ToolApprovalLevel | undefined, requiredPermissions: readonly string[] | undefined): ToolSecurityManifest {
    return { risk, requiredPermissions: requiredPermissions ?? [permission], ...(approval ? { approval } : {}) };
  }

  function makeTool(name: string, description: string, input: z.ZodObject, risk: ToolActionRisk, manifest: ToolSecurityManifest, timeoutMs: number, custom: Record<string, unknown>, plan: (input: Record<string, unknown>) => CallPlan): AnyToolDefinition {
    const toolName = `${namespace}.${name}`;
    assertValidToolName(toolName);
    return {
      name: toolName,
      description,
      inputSchema: input,
      security: manifest,
      metadata: {
        source: 'connector',
        executionLocation: 'server',
        timeoutMs,
        concurrency: risk === 'read-only' ? 'parallel-safe' : 'serial',
        readOnly: risk === 'read-only',
        destructive: risk === 'destructive',
        custom: { sourceType: 'http-api', integrationId: config.id, ...custom },
      },
      async execute(value: unknown, context: ToolExecutionContext): Promise<unknown> {
        const call = plan(value as Record<string, unknown>);
        const errorContext = { integrationId: config.id, toolName, method: call.method, path: call.path };
        const isWrite = call.method !== 'get';
        const idempotencyKey = isWrite && config.idempotencyKeyHeader ? randomUUID() : undefined;
        let credentialHeaders: Readonly<Record<string, string>> = {};
        try {
          credentialHeaders = credentialsToHeaders(await credentialProvider.getCredentials({ integrationId: config.id, executionContext: context }));
          // Credentials always win over any same-named header, and are never model input.
          const protectedNames = new Set(Object.keys(credentialHeaders).map((key) => key.toLowerCase()));
          const headers: Record<string, string> = {
            ...Object.fromEntries(Object.entries({ ...config.headers, ...call.headers }).filter(([key]) => !protectedNames.has(key.toLowerCase()))),
            ...credentialHeaders,
            ...(idempotencyKey && config.idempotencyKeyHeader ? { [config.idempotencyKeyHeader]: idempotencyKey } : {}),
          };
          const response = await measureIntegration(config.onTelemetry, { stage: 'execute', integrationId: config.id, toolName }, () =>
            withRetry(
              call.method,
              idempotencyKey !== undefined,
              config.retry ?? {},
              () =>
                executor.execute({
                  method: call.method,
                  baseUrl: config.baseUrl,
                  pathTemplate: call.path,
                  pathParams: call.pathParams,
                  queryParams: call.queryParams,
                  headers,
                  body: call.body,
                  bodyEncoding: call.bodyEncoding,
                  timeoutMs: call.timeoutMs,
                  signal: context.signal,
                }),
              (result) => ({ retryableStatus: result.status >= 400 ? result.status : undefined }),
              undefined,
              context.signal,
            ),
          );
          if (response.status >= 300) throw normalizeHttpError(response, errorContext);
          let body = response.body;
          if (call.output) {
            const checked = call.output.safeParse(body);
            if (!checked.success) throw CopilotError.toolOutputInvalid('The API response does not match its declared schema.');
            body = checked.data;
          }
          const result: HttpApiToolResult = { status: response.status, body };
          return redactCredentialValues(result, credentialHeaders);
        } catch (error) {
          throw normalizeExecutionError(error, errorContext);
        }
      },
    };
  }

  for (const [name, endpoint] of Object.entries(config.endpoints ?? {})) {
    if (endpoint.enabled === false) continue;
    if (!endpoint.description.trim()) throw new Error(`Endpoint "${name}" needs a description.`);
    if (!endpoint.path.startsWith('/')) throw new Error(`Endpoint "${name}": path must start with "/".`);
    const input = endpoint.input ?? z.object({});
    const fields = Object.keys(input.shape);
    const placeholders = placeholdersOf(endpoint.path);
    for (const placeholder of placeholders) {
      if (!fields.includes(placeholder)) throw new Error(`Endpoint "${name}": path placeholder {${placeholder}} has no matching input field.`);
    }
    const locations: Record<string, ParamLocation> = {};
    for (const field of fields) {
      locations[field] = endpoint.params?.[field] ?? (placeholders.includes(field) ? 'path' : endpoint.method === 'get' || endpoint.method === 'delete' ? 'query' : 'body');
      if (locations[field] === 'path' && !placeholders.includes(field)) throw new Error(`Endpoint "${name}": field "${field}" is mapped to the path but the path has no {${field}}.`);
    }
    const risk = endpoint.risk ?? METHOD_RISK[endpoint.method];
    const timeoutMs = endpoint.timeoutMs ?? config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    tools.push(
      makeTool(name, endpoint.description, input, risk, security(risk, endpoint.approval, endpoint.requiredPermissions), timeoutMs, { method: endpoint.method, path: endpoint.path, endpoint: describeMethod(endpoint.method, endpoint.path) }, (value) => {
        const pathParams: Record<string, string> = {};
        const queryParams: Record<string, string | string[]> = {};
        const headers: Record<string, string> = { ...endpoint.headers };
        const body: Record<string, unknown> = {};
        let hasBody = false;
        for (const [field, fieldValue] of Object.entries(value)) {
          if (fieldValue === undefined) continue;
          switch (locations[field]) {
            case 'path':
              pathParams[field] = toParam(fieldValue);
              break;
            case 'query':
              queryParams[field] = Array.isArray(fieldValue) ? fieldValue.map(toParam) : toParam(fieldValue);
              break;
            case 'header':
              headers[field] = toParam(fieldValue);
              break;
            case 'body':
            case undefined:
              body[field] = fieldValue;
              hasBody = true;
              break;
          }
        }
        return { method: endpoint.method, path: endpoint.path, pathParams, queryParams, headers, body: hasBody ? body : undefined, bodyEncoding: endpoint.bodyEncoding ?? 'json', timeoutMs, output: endpoint.output };
      }),
    );
  }

  const graphqlPath = config.graphql?.path ?? '/graphql';
  for (const [name, operation] of Object.entries(config.graphql?.operations ?? {})) {
    if (operation.enabled === false) continue;
    if (!operation.description.trim()) throw new Error(`GraphQL operation "${name}" needs a description.`);
    const isMutation = /^\s*mutation\b/.test(operation.query);
    const risk = operation.risk ?? (isMutation ? 'write' : 'read-only');
    const variables = operation.variables ?? z.object({});
    const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    // GraphQL reports failures inside a 200 response, so errors are checked before `data`.
    const graphOutput = z.object({ data: z.unknown().optional(), errors: z.array(z.object({ message: z.string() }).loose()).optional() }).loose();
    const tool = makeTool(name, operation.description, variables, risk, security(risk, operation.approval, operation.requiredPermissions), timeoutMs, { method: 'post', path: graphqlPath, graphql: isMutation ? 'mutation' : 'query' }, (value) => ({
      method: 'post',
      path: graphqlPath,
      pathParams: {},
      queryParams: {},
      headers: {},
      body: { query: operation.query, variables: value },
      bodyEncoding: 'json',
      timeoutMs,
      output: graphOutput,
    }));
    // GraphQL reports failures inside a 200 response; surface them as tool errors.
    const execute = tool.execute.bind(tool);
    tools.push({
      ...tool,
      async execute(value: unknown, context: ToolExecutionContext): Promise<unknown> {
        const result = (await execute(value, context)) as HttpApiToolResult;
        const payload = result.body as { data?: unknown; errors?: readonly { message: string }[] };
        if (payload.errors && payload.errors.length > 0) {
          throw CopilotError.toolExecutionError(`GraphQL error: ${payload.errors.map((error) => error.message).join('; ').slice(0, 500)}`);
        }
        if (operation.output) {
          const checked = operation.output.safeParse(payload.data);
          if (!checked.success) throw CopilotError.toolOutputInvalid('The GraphQL response does not match its declared schema.');
          return { status: result.status, body: checked.data };
        }
        return { status: result.status, body: payload.data };
      },
    });
  }

  const names = tools.map((tool) => tool.name);
  const duplicate = names.find((name, index) => names.indexOf(name) !== index);
  if (duplicate) throw new Error(`API "${config.id}" defines the tool "${duplicate}" twice.`);

  return {
    id: config.id,
    baseUrl: config.baseUrl,
    tools,
    register(registry) {
      const registrations = tools.map((tool) => registry.register(tool));
      return () => registrations.forEach((registration) => registration.dispose());
    },
  };
}
