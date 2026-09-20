import { z } from 'zod';
import { jsonSchemaToZod } from '@gixcopilot/tools';
import type { JsonSchemaConversionIssue } from '@gixcopilot/tools';
import type { OpenAPIOperationCandidate } from './types.js';

export type OperationInputFieldTarget =
  | { readonly kind: 'path' | 'query' | 'header'; readonly name: string }
  | { readonly kind: 'body' };

export interface OperationInputField {
  readonly toolField: string;
  readonly target: OperationInputFieldTarget;
}

/** The flattened tool-input schema for one operation, plus enough information (`fields`) for
 * the HTTP executor to route each validated field back to the path/query/header/body slot it
 * came from - `jsonSchemaToZod`'s output alone can't express that routing. */
export interface OperationInputPlan {
  readonly schema: z.ZodObject;
  readonly fields: readonly OperationInputField[];
}

export type OperationInputResult =
  | { readonly ok: true; readonly plan: OperationInputPlan }
  | { readonly ok: false; readonly issues: readonly JsonSchemaConversionIssue[] };

const BODY_FIELD = 'body';
const RESERVED_HEADERS = new Set(['authorization', 'proxy-authorization', 'cookie', 'set-cookie', 'x-api-key', 'host', 'connection', 'content-length', 'transfer-encoding']);

function namespacedIssues(prefix: string, issues: readonly JsonSchemaConversionIssue[]): JsonSchemaConversionIssue[] {
  return issues.map((issue) => ({ path: `${prefix}${issue.path.slice(1)}`, reason: issue.reason }));
}

/**
 * Builds the flattened tool-input schema for one operation (Section 22-26): path and query
 * parameters become top-level fields (e.g. `applicationId`, `status`); the JSON request body,
 * if any, becomes a nested `body` field, matching Section 26's own example exactly
 * (`{ applicationId: string; body: { officerId: string } }`) rather than flattening body
 * properties into the top level, which would risk colliding with parameter names.
 *
 * Header parameters are never exposed as model-controlled input unless explicitly allowlisted
 * via `allowedHeaderParameters` (Section 24 - `Authorization`/`X-API-Key`-style headers must
 * come from integration credentials, not the model). Cookie parameters are always excluded
 * outright (Section 25 - no allowlist exception for authentication cookies).
 *
 * A name collision (two parameters sharing a name across locations, or a parameter literally
 * named `"body"` alongside a request body) is reported as a conversion issue rather than
 * silently resolved, matching Section 28's "skip operation or require override with a clear
 * diagnostic" policy for anything that cannot be represented safely and unambiguously.
 */
export function buildOperationInputPlan(
  candidate: OpenAPIOperationCandidate,
  options: { readonly allowedHeaderParameters?: readonly string[] } = {},
): OperationInputResult {
  const issues: JsonSchemaConversionIssue[] = (candidate.issues ?? []).map((reason) => ({ path: '$', reason }));
  const fields: OperationInputField[] = [];
  const shape: Record<string, z.ZodType> = {};
  const seenNames = new Set<string>();
  const allowedHeaders = new Set((options.allowedHeaderParameters ?? []).map((name) => name.toLowerCase()));

  const exposedParameters = candidate.parameters.filter((parameter) => {
    if (parameter.in === 'cookie') return false;
    if (parameter.in === 'header') return !RESERVED_HEADERS.has(parameter.name.toLowerCase()) && allowedHeaders.has(parameter.name.toLowerCase());
    return true;
  });

  for (const parameter of exposedParameters) {
    const type = parameter.schema.type;
    const expectedStyle = parameter.in === 'query' ? 'form' : 'simple';
    if ((parameter.style !== undefined && parameter.style !== expectedStyle) || type === 'object' || (type === 'array' && (parameter.in !== 'query' || parameter.explode === false))) {
      issues.push({ path: `$.${parameter.name}`, reason: 'Unsupported parameter serialization; use primitives or exploded form query arrays.' });
      continue;
    }
    if (seenNames.has(parameter.name)) {
      issues.push({
        path: `$.${parameter.name}`,
        reason: `Parameter name "${parameter.name}" is used by more than one parameter location - provide an override to disambiguate.`,
      });
      continue;
    }
    seenNames.add(parameter.name);

    const converted = jsonSchemaToZod(parameter.schema);
    if (!converted.ok) {
      issues.push(...namespacedIssues(`$.${parameter.name}`, converted.issues));
      continue;
    }
    const field = parameter.required ? converted.schema : converted.schema.optional();
    shape[parameter.name] = parameter.description ? field.describe(parameter.description) : field;
    fields.push({
      toolField: parameter.name,
      target: { kind: parameter.in as 'path' | 'query' | 'header', name: parameter.name },
    });
  }

  if (candidate.requestBodySchema) {
    if (seenNames.has(BODY_FIELD)) {
      issues.push({
        path: `$.${BODY_FIELD}`,
        reason: 'A parameter is already named "body", which collides with the request body field.',
      });
    } else {
      const converted = jsonSchemaToZod(candidate.requestBodySchema);
      if (!converted.ok) {
        issues.push(...namespacedIssues(`$.${BODY_FIELD}`, converted.issues));
      } else {
        shape[BODY_FIELD] = candidate.requestBodyRequired ? converted.schema : converted.schema.optional();
        fields.push({ toolField: BODY_FIELD, target: { kind: 'body' } });
      }
    }
  }

  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, plan: { schema: z.object(shape), fields } };
}
