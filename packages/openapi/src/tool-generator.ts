import { measureIntegration } from '@gixcopilot/tools';
import type { IntegrationTelemetryObserver } from '@gixcopilot/tools';
import { z } from 'zod';
import { CopilotError } from '@gixcopilot/protocol';
import { createHash, randomUUID } from 'node:crypto';
import { credentialsToHeaders, noCredentialsProvider, jsonSchemaToZod, redactCredentialValues } from '@gixcopilot/tools';
import type { AnyToolDefinition, CredentialProvider, ToolExecutionContext } from '@gixcopilot/tools';
import { normalizeExecutionError, normalizeHttpError } from './error-normalization.js';
import { resolveOperationExposure } from './exposure-policy.js';
import type { ExposurePolicyOptions } from './exposure-policy.js';
import { createFetchHttpExecutor } from './http-executor.js';
import type { HttpExecutor } from './http-executor.js';
import { buildOperationInputPlan } from './input-schema.js';
import type { OperationInputPlan } from './input-schema.js';
import { createOpenAPILoader } from './loader.js';
import type { OpenAPILoader } from './loader.js';
import { deriveToolName, detectNamingConflicts, operationKey } from './naming.js';
import { CircularReferenceError, resolveLocalRefs, UnresolvableReferenceError } from './ref-resolver.js';
import type { RetryPolicy } from './retry.js';
import { withRetry } from './retry.js';
import { buildSecurityMetadata } from './security-metadata.js';
import { discoverOperations } from './operation-discovery.js';
import { validateOpenAPIDocument } from './validator.js';
import type {
  DocumentIssue,
  OpenAPIGenerationReport,
  OpenAPIOperationCandidate,
  OpenAPIOperationOverride,
  OpenAPISource,
  OpenAPIToolSourceMetadata,
  RegistrationConflict,
} from './types.js';

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_DESCRIPTION_LENGTH = 500;

export interface GenerateOpenAPIToolsOptions extends ExposurePolicyOptions {
  readonly onTelemetry?: IntegrationTelemetryObserver;
  readonly integrationId: string;
  readonly source: OpenAPISource;
  /** Prepended to every generated tool's name (Section 19), e.g. `"vas"` -> `vas.applications.get`. */
  readonly namespace?: string;
  /** Overrides the document's `servers[0].url` (Section 35) - required if the document has no
   * `servers` entry. Never taken from model input. */
  readonly baseUrl?: string;
  readonly operations?: Readonly<Record<string, OpenAPIOperationOverride>>;
  readonly credentialProvider?: CredentialProvider;
  readonly httpExecutor?: HttpExecutor;
  readonly loader?: OpenAPILoader;
  readonly defaultPermission?: string | ((candidate: OpenAPIOperationCandidate) => string);
  readonly timeoutMs?: number;
  readonly retry?: RetryPolicy;
  /** Header name used for a generated idempotency key on write operations (Section 56), e.g.
   * `"Idempotency-Key"`. Unset by default - this SDK never invents an idempotency guarantee
   * the external API has not opted into. */
  readonly idempotencyKeyHeader?: string;
  /** Post-processes a tool's result before it is returned (Section 59) - Phase 7's data policy
   * still applies afterward, uniformly, in the server's dispatch pipeline (Section 32). */
  readonly transformResult?: (result: OpenAPIToolResult, candidate: OpenAPIOperationCandidate) => unknown;
}

export interface OpenAPIToolResult {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: unknown;
}

export interface GenerateOpenAPIToolsResult {
  readonly tools: readonly AnyToolDefinition[];
  readonly report: OpenAPIGenerationReport;
}

function emptyReport(
  integrationId: string,
  documentIssues: readonly DocumentIssue[],
  operationsDiscovered = 0,
): OpenAPIGenerationReport {
  return {
    integrationId,
    documentIssues,
    operationsDiscovered,
    generated: 0,
    skipped: 0,
    denied: 0,
    unsupported: 0,
    warnings: [],
    conflicts: [],
  };
}

function buildDescription(candidate: OpenAPIOperationCandidate, override: OpenAPIOperationOverride | undefined): string {
  const base = override?.description ?? candidate.summary ?? candidate.description ?? `${candidate.method.toUpperCase()} ${candidate.path}`;
  return base.length > MAX_DESCRIPTION_LENGTH ? `${base.slice(0, MAX_DESCRIPTION_LENGTH - 3)}...` : base;
}

interface BuildToolParams {
  readonly onTelemetry?: IntegrationTelemetryObserver;
  readonly name: string;
  readonly description: string;
  readonly plan: OperationInputPlan;
  readonly outputSchema: z.ZodType;
  readonly documentVersion: string;
  readonly candidate: OpenAPIOperationCandidate;
  readonly security: ReturnType<typeof buildSecurityMetadata>;
  readonly integrationId: string;
  readonly specVersion?: string;
  readonly baseUrl: string;
  readonly httpExecutor: HttpExecutor;
  readonly credentialProvider: CredentialProvider;
  readonly timeoutMs: number;
  readonly retryPolicy: RetryPolicy;
  readonly idempotencyKeyHeader?: string;
  readonly transformResult?: (result: OpenAPIToolResult, candidate: OpenAPIOperationCandidate) => unknown;
}

function buildToolDefinition(params: BuildToolParams): AnyToolDefinition {
  const { name, description, plan, candidate, security, integrationId, specVersion, baseUrl, httpExecutor, credentialProvider, timeoutMs, retryPolicy, idempotencyKeyHeader, transformResult } = params;

  const sourceMetadata: OpenAPIToolSourceMetadata = {
    sourceType: 'openapi',
    integrationId,
    operationId: candidate.operationId,
    method: candidate.method,
    path: candidate.path,
    specVersion,
    documentVersion: params.documentVersion,
  };

  return {
    name,
    description,
    inputSchema: plan.schema,
    outputSchema: transformResult ? undefined : params.outputSchema,
    security,
    metadata: {
      source: 'openapi',
      executionLocation: 'server',
      timeoutMs,
      concurrency: security.risk === 'read-only' ? 'parallel-safe' : 'serial',
      readOnly: security.risk === 'read-only',
      destructive: security.risk === 'destructive',
      custom: { ...sourceMetadata },
    },
    async execute(input: unknown, context: ToolExecutionContext): Promise<unknown> {
      const parsedInput = input as Readonly<Record<string, unknown>>;
      const pathParams: Record<string, string> = {};
      const queryParams: Record<string, string | readonly string[]> = {};
      const headers: Record<string, string> = {};
      let body: unknown;

      for (const field of plan.fields) {
        const value = parsedInput[field.toolField];
        if (value === undefined) continue;
        switch (field.target.kind) {
          case 'path':
            pathParams[field.target.name] = toParamString(value);
            break;
          case 'query':
            queryParams[field.target.name] = Array.isArray(value) ? value.map(toParamString) : toParamString(value);
            break;
          case 'header':
            headers[field.target.name] = toParamString(value);
            break;
          case 'body':
            body = value;
            break;
        }
      }

      const errorContext = { integrationId, toolName: name, method: candidate.method, path: candidate.path };
      const isWriteMethod = candidate.method !== 'get' && candidate.method !== 'head' && candidate.method !== 'options' && candidate.method !== 'trace';
      const idempotencyKey = idempotencyKeyHeader !== undefined && isWriteMethod ? randomUUID() : undefined;

      try {
        const credentials = await credentialProvider.getCredentials({ integrationId, executionContext: context });
        const credentialHeaders = credentialsToHeaders(credentials);
        const protectedNames = new Set(Object.keys(credentialHeaders).map((key) => key.toLowerCase()));
        const requestHeaders: Record<string, string> = {
          ...Object.fromEntries(Object.entries(headers).filter(([key]) => !protectedNames.has(key.toLowerCase()))),
          ...credentialHeaders,
          ...(idempotencyKey !== undefined && idempotencyKeyHeader !== undefined ? { [idempotencyKeyHeader]: idempotencyKey } : {}),
        };

        const response = await measureIntegration(params.onTelemetry, { stage: 'execute', integrationId, toolName: name }, () => withRetry(
          candidate.method,
          idempotencyKey !== undefined,
          retryPolicy,
          () =>
            httpExecutor.execute({
              method: candidate.method,
              baseUrl,
              pathTemplate: candidate.path,
              pathParams,
              queryParams,
              headers: requestHeaders,
              body,
              timeoutMs,
              signal: context.signal,
            }),
          (result) => ({ retryableStatus: result.status >= 400 ? result.status : undefined }),
          undefined, context.signal,
        ));

        if (response.status >= 300) throw normalizeHttpError(response, errorContext);

        const checked = params.outputSchema.safeParse(response);
        if (!checked.success) throw CopilotError.toolOutputInvalid('External API response does not match its declared schema.');
        const normalized: OpenAPIToolResult = { status: response.status, headers: response.headers, body: (checked.data as OpenAPIToolResult).body };
        return redactCredentialValues(transformResult ? transformResult(normalized, candidate) : normalized, credentialHeaders);
      } catch (error) {
        throw normalizeExecutionError(error, errorContext);
      }
    },
  };
}

/** Path/query/header parameter values are validated primitives per `input-schema.ts`'s
 * conversion (string/number/boolean); `JSON.stringify` is only a defensive fallback for a
 * shape that conversion should never actually produce here. */
function toParamString(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value) ?? '';
}

function documentIssueFromError(error: unknown): DocumentIssue {
  if (error instanceof UnresolvableReferenceError || error instanceof CircularReferenceError) {
    return { path: '$', problem: error.message };
  }
  return { path: '$', problem: 'Failed to load or parse the OpenAPI document. Check the configured source.' };
}

/**
 * The full generation pipeline (Section 15): Document -> Operation Candidates -> Exposure
 * Policy -> Schema Conversion -> `ToolDefinition`s + `OpenAPIGenerationReport`. Registry-
 * agnostic - this function never calls a `ToolRegistry`; `inspect-openapi.ts` and
 * `register-openapi.ts` are the two public entry points built on top of it (Section 106-107's
 * inspect-before-register separation).
 */
async function generate(options: GenerateOpenAPIToolsOptions): Promise<GenerateOpenAPIToolsResult> {
  const loader = options.loader ?? createOpenAPILoader();
  const httpExecutor = options.httpExecutor ?? createFetchHttpExecutor();
  const credentialProvider = options.credentialProvider ?? noCredentialsProvider();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const retryPolicy = options.retry ?? {};

  let resolvedRaw: unknown;
  try {
    const raw = await measureIntegration(options.onTelemetry, { stage: 'load', integrationId: options.integrationId }, () => loader.load(options.source));
    resolvedRaw = resolveLocalRefs(raw);
  } catch (error) {
    return { tools: [], report: emptyReport(options.integrationId, [documentIssueFromError(error)]) };
  }

  const validated = validateOpenAPIDocument(resolvedRaw);
  if (!validated.ok) {
    return {
      tools: [],
      report: emptyReport(
        options.integrationId,
        validated.issues.map((issue) => ({ path: issue.path, problem: issue.problem })),
      ),
    };
  }

  const candidates = discoverOperations(validated.document);
  const baseUrl = options.baseUrl ?? validated.document.servers?.[0]?.url;
  if (baseUrl === undefined) {
    return {
      tools: [],
      report: emptyReport(
        options.integrationId,
        [{ path: '$.servers', problem: 'No base URL is available - provide options.baseUrl or a document "servers" entry.' }],
        candidates.length,
      ),
    };
  }

  const decisions = candidates.map((candidate) => ({
    candidate,
    decision: resolveOperationExposure(candidate, {
      policies: options.policies,
      include: options.include ?? Object.keys(options.operations ?? {}).filter((key) => options.operations?.[key]?.expose !== false),
      exclude: options.exclude,
      operations: options.operations,
    }),
  }));

  const exposed = decisions.filter((entry) => entry.decision.exposure !== 'deny');
  const denied = decisions.length - exposed.length;

  const named = exposed.map((entry) => ({
    ...entry,
    key: operationKey(entry.candidate),
    name: deriveToolName(entry.candidate, { namespace: options.namespace, overrideName: entry.decision.override?.name }),
  }));

  const conflicts: readonly RegistrationConflict[] = detectNamingConflicts(
    named.map((entry) => ({ name: entry.name, operation: entry.key })),
  );
  const conflictingNames = new Set(conflicts.map((conflict) => conflict.name));

  const documentVersion = createHash('sha256').update(JSON.stringify(resolvedRaw)).digest('hex');
  const tools: AnyToolDefinition[] = [];
  const warnings: { readonly operation: string; readonly message: string }[] = [];
  let generated = 0;
  let skipped = 0;
  let unsupported = 0;

  for (const entry of named) {
    if (conflictingNames.has(entry.name)) {
      skipped += 1;
      continue;
    }

    const inputResult = buildOperationInputPlan(entry.candidate, {
      allowedHeaderParameters: entry.decision.override?.allowedHeaderParameters,
    });
    if (!inputResult.ok) {
      unsupported += 1;
      warnings.push({
        operation: entry.key,
        message: inputResult.issues.map((issue) => `${issue.path}: ${issue.reason}`).join('; '),
      });
      continue;
    }

    const responseSchemas: Record<string, z.ZodType> = {};
    let invalidResponse = false;
    for (const [status, schema] of Object.entries(entry.candidate.responseSchemas ?? {})) {
      const converted = jsonSchemaToZod(schema, 'output');
      if (!converted.ok) {
        invalidResponse = true;
        warnings.push({ operation: entry.key, message: `Unsupported response schema (${status}): ${converted.issues.map((issue) => issue.reason).join('; ')}` });
      } else responseSchemas[status] = converted.schema;
    }
    if (invalidResponse) { unsupported++; continue; }
    const outputSchema = z.object({ status: z.number(), headers: z.record(z.string(), z.string()), body: z.unknown().optional() }).transform((value, ctx) => {
      const schema = responseSchemas[String(value.status)] ?? responseSchemas['2XX'] ?? responseSchemas['default'];
      if (!schema) return value;
      const parsed = schema.safeParse(value.body);
      if (!parsed.success) { ctx.addIssue({ code: 'custom', message: 'Invalid external response body.' }); return z.NEVER; }
      return { ...value, body: parsed.data };
    });
    const security = buildSecurityMetadata(entry.candidate, entry.decision, {
      integrationId: options.integrationId,
      defaultPermission: options.defaultPermission,
    });

    tools.push(
      buildToolDefinition({
        onTelemetry: options.onTelemetry,
        name: entry.name,
        description: buildDescription(entry.candidate, entry.decision.override),
        plan: inputResult.plan,
        outputSchema,
        documentVersion,
        candidate: entry.candidate,
        security,
        integrationId: options.integrationId,
        specVersion: validated.document.openapi,
        baseUrl,
        httpExecutor,
        credentialProvider,
        timeoutMs,
        retryPolicy,
        idempotencyKeyHeader: options.idempotencyKeyHeader,
        transformResult: options.transformResult,
      }),
    );
    generated += 1;
  }

  return {
    tools,
    report: {
      integrationId: options.integrationId,
      documentIssues: [],
      operationsDiscovered: candidates.length,
      generated,
      skipped,
      denied,
      unsupported,
      warnings,
      conflicts,
    },
  };
}

export function generateOpenAPITools(options: GenerateOpenAPIToolsOptions): Promise<GenerateOpenAPIToolsResult> {
  return measureIntegration(options.onTelemetry, { stage: 'generate', integrationId: options.integrationId }, () => generate(options));
}
