import { readFile } from 'node:fs/promises';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { jsonSchemaToZod } from '@gixcopilot/tools';
import type { CredentialProvider, IntegrationCredentials } from '@gixcopilot/tools';
import { defineHttpApi } from './http-api.js';
import type { GraphQLOperation, HttpApi, HttpApiConfig, HttpEndpoint } from './http-api.js';

/**
 * A declarative description of any HTTP API, for teams that do not write TypeScript or want the
 * API definition next to the service it describes (any language, any framework). JSON or YAML.
 * Secrets are never written in the manifest: credentials and URLs can reference environment
 * variables (`${env:NAME}`), resolved on the server.
 */
const jsonSchema = z.record(z.string(), z.unknown());
const approvalLevel = z.enum(['none', 'user-confirmation', 'supervisor', 'admin', 'two-person']);

const endpointSchema = z.strictObject({
  method: z.string().transform((value) => value.toLowerCase()).pipe(z.enum(['get', 'post', 'put', 'patch', 'delete'])),
  path: z.string().startsWith('/'),
  description: z.string().min(1),
  input: jsonSchema.optional(),
  output: jsonSchema.optional(),
  params: z.record(z.string(), z.enum(['path', 'query', 'header', 'body'])).optional(),
  bodyEncoding: z.enum(['json', 'form']).optional(),
  risk: z.enum(['read-only', 'write', 'destructive']).optional(),
  approval: approvalLevel.optional(),
  permissions: z.array(z.string()).optional(),
  headers: z.record(z.string(), z.string()).optional(),
  timeoutMs: z.number().int().positive().optional(),
  enabled: z.boolean().optional(),
});

const operationSchema = z.strictObject({
  description: z.string().min(1),
  query: z.string().min(1),
  variables: jsonSchema.optional(),
  output: jsonSchema.optional(),
  risk: z.enum(['read-only', 'write', 'destructive']).optional(),
  approval: approvalLevel.optional(),
  permissions: z.array(z.string()).optional(),
  enabled: z.boolean().optional(),
});

const authSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('none') }),
  z.strictObject({ type: z.literal('bearer'), tokenEnv: z.string().min(1) }),
  z.strictObject({ type: z.literal('apiKey'), header: z.string().min(1), valueEnv: z.string().min(1) }),
  z.strictObject({ type: z.literal('basic'), usernameEnv: z.string().min(1), passwordEnv: z.string().min(1) }),
  z.strictObject({ type: z.literal('headers'), headersEnv: z.record(z.string(), z.string().min(1)) }),
]);

export const httpApiManifestSchema = z.strictObject({
  id: z.string().min(1),
  baseUrl: z.string().min(1),
  description: z.string().optional(),
  namespace: z.string().optional(),
  auth: authSchema.optional(),
  defaultPermission: z.string().optional(),
  headers: z.record(z.string(), z.string()).optional(),
  timeoutMs: z.number().int().positive().optional(),
  retry: z.strictObject({ maxAttempts: z.number().int().min(1).max(10).optional(), baseDelayMs: z.number().int().nonnegative().optional() }).optional(),
  idempotencyKeyHeader: z.string().optional(),
  endpoints: z.record(z.string(), endpointSchema).optional(),
  graphql: z.strictObject({ path: z.string().startsWith('/').optional(), operations: z.record(z.string(), operationSchema) }).optional(),
});

export type HttpApiManifest = z.input<typeof httpApiManifestSchema>;

export interface LoadManifestOptions {
  /** Environment used for `${env:NAME}` and credential variables. Default `process.env`. */
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** Extra options merged into the resulting config (for example a custom HTTP executor). */
  readonly overrides?: Partial<Omit<HttpApiConfig, 'id' | 'endpoints' | 'graphql'>>;
}

function interpolate(value: string, env: Readonly<Record<string, string | undefined>>, where: string): string {
  return value.replace(/\$\{env:([A-Za-z_][A-Za-z0-9_]*)\}/g, (_match, name: string) => {
    const resolved = env[name];
    if (resolved === undefined || resolved === '') throw new Error(`${where}: environment variable ${name} is not set.`);
    return resolved;
  });
}

function toObjectSchema(schema: Record<string, unknown> | undefined, where: string): z.ZodObject | undefined {
  if (!schema) return undefined;
  const converted = jsonSchemaToZod(schema, 'input');
  if (!converted.ok) throw new Error(`${where}: unsupported JSON Schema (${converted.issues.map((issue) => `${issue.path}: ${issue.reason}`).join('; ')}).`);
  if (!(converted.schema instanceof z.ZodObject)) throw new Error(`${where}: input must be a JSON Schema object ("type": "object").`);
  return converted.schema;
}

function toOutputSchema(schema: Record<string, unknown> | undefined, where: string): z.ZodType | undefined {
  if (!schema) return undefined;
  const converted = jsonSchemaToZod(schema, 'output');
  if (!converted.ok) throw new Error(`${where}: unsupported output JSON Schema.`);
  return converted.schema;
}

/** Credentials are read from the environment on every call (so rotation needs no restart). */
function envCredentials(auth: z.infer<typeof authSchema> | undefined, env: Readonly<Record<string, string | undefined>>, apiId: string): CredentialProvider | undefined {
  if (!auth || auth.type === 'none') return undefined;
  const read = (name: string): string => {
    const value = env[name];
    if (!value) throw new Error(`API "${apiId}": credential environment variable ${name} is not set.`);
    return value;
  };
  return {
    getCredentials(): Promise<IntegrationCredentials> {
      switch (auth.type) {
        case 'bearer':
          return Promise.resolve({ kind: 'bearer', token: read(auth.tokenEnv) });
        case 'apiKey':
          return Promise.resolve({ kind: 'apiKey', headerName: auth.header, value: read(auth.valueEnv) });
        case 'basic':
          return Promise.resolve({ kind: 'basic', username: read(auth.usernameEnv), password: read(auth.passwordEnv) });
        case 'headers':
          return Promise.resolve({ kind: 'custom', headers: Object.fromEntries(Object.entries(auth.headersEnv).map(([header, name]) => [header, read(name)])) });
      }
    },
  };
}

/** Turns a parsed manifest object into an `HttpApi` (validated; unknown keys are rejected). */
export function httpApiFromManifest(manifest: unknown, options: LoadManifestOptions = {}): HttpApi {
  const env = options.env ?? process.env;
  const parsed = httpApiManifestSchema.safeParse(manifest);
  if (!parsed.success) {
    throw new Error(`Invalid API manifest: ${parsed.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`).join('; ')}`);
  }
  const data = parsed.data;
  const where = `API "${data.id}"`;
  const endpoints: Record<string, HttpEndpoint> = {};
  for (const [name, endpoint] of Object.entries(data.endpoints ?? {})) {
    endpoints[name] = {
      method: endpoint.method,
      path: endpoint.path,
      description: endpoint.description,
      input: toObjectSchema(endpoint.input, `${where} endpoint "${name}"`),
      output: toOutputSchema(endpoint.output, `${where} endpoint "${name}"`),
      params: endpoint.params,
      bodyEncoding: endpoint.bodyEncoding,
      risk: endpoint.risk,
      approval: endpoint.approval,
      requiredPermissions: endpoint.permissions,
      headers: endpoint.headers,
      timeoutMs: endpoint.timeoutMs,
      enabled: endpoint.enabled,
    };
  }
  const operations: Record<string, GraphQLOperation> = {};
  for (const [name, operation] of Object.entries(data.graphql?.operations ?? {})) {
    operations[name] = {
      description: operation.description,
      query: operation.query,
      variables: toObjectSchema(operation.variables, `${where} GraphQL operation "${name}"`),
      output: toOutputSchema(operation.output, `${where} GraphQL operation "${name}"`),
      risk: operation.risk,
      approval: operation.approval,
      requiredPermissions: operation.permissions,
      enabled: operation.enabled,
    };
  }
  return defineHttpApi({
    ...options.overrides,
    id: data.id,
    baseUrl: interpolate(data.baseUrl, env, where),
    description: data.description,
    namespace: data.namespace,
    credentials: options.overrides?.credentials ?? envCredentials(data.auth, env, data.id),
    defaultPermission: data.defaultPermission,
    headers: data.headers,
    timeoutMs: data.timeoutMs,
    retry: data.retry,
    idempotencyKeyHeader: data.idempotencyKeyHeader,
    endpoints,
    graphql: data.graphql ? { path: data.graphql.path, operations } : undefined,
  });
}

/** Reads a `.json`, `.yaml` or `.yml` manifest file and builds its tools. */
export async function loadHttpApiManifest(file: string, options: LoadManifestOptions = {}): Promise<HttpApi> {
  const text = await readFile(file, 'utf8');
  const data: unknown = /\.ya?ml$/i.test(file) ? parseYaml(text) : JSON.parse(text);
  return httpApiFromManifest(data, options);
}
