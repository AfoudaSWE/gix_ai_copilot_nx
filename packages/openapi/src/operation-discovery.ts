import type { JsonSchemaLike } from '@gixcopilot/tools';
import type {
  HttpMethod,
  OpenAPIDocument,
  OpenAPIOperationCandidate,
  OpenAPIParameterCandidate,
} from './types.js';

const HTTP_METHODS: readonly HttpMethod[] = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toSchema(value: unknown): JsonSchemaLike {
  return isRecord(value) ? value : {};
}

function toParameterCandidate(raw: unknown): OpenAPIParameterCandidate | undefined {
  if (!isRecord(raw)) return undefined;
  const name = raw['name'];
  const location = raw['in'];
  if (typeof name !== 'string') return undefined;
  if (location !== 'path' && location !== 'query' && location !== 'header' && location !== 'cookie') return undefined;
  return {
    name,
    in: location,
    style: typeof raw['style'] === 'string' ? raw['style'] : undefined,
    explode: typeof raw['explode'] === 'boolean' ? raw['explode'] : undefined,
    required: location === 'path' ? true : raw['required'] === true,
    schema: toSchema(raw['schema']),
    description: typeof raw['description'] === 'string' ? raw['description'] : undefined,
  };
}

function requestBodyOf(raw: unknown): { schema?: JsonSchemaLike; required?: boolean } {
  if (!isRecord(raw)) return {};
  const content = raw['content'];
  if (!isRecord(content)) return {};
  const json = content['application/json'];
  if (!isRecord(json)) return {};
  return { schema: toSchema(json['schema']), required: raw['required'] === true };
}

/**
 * Walks `paths` (Section 14) and produces one `OpenAPIOperationCandidate` per HTTP-method
 * operation - non-operation path metadata (`parameters` shared across methods, `summary` at
 * the path level, vendor extensions) is folded in where it affects a candidate, otherwise
 * ignored, never mistaken for an operation itself.
 */
export function discoverOperations(document: OpenAPIDocument): readonly OpenAPIOperationCandidate[] {
  const candidates: OpenAPIOperationCandidate[] = [];
  for (const [path, pathItem] of Object.entries(document.paths ?? {})) {
    if (!isRecord(pathItem)) continue;
    const pathLevelParameters = Array.isArray(pathItem['parameters'])
      ? pathItem['parameters'].map(toParameterCandidate).filter((p): p is OpenAPIParameterCandidate => p !== undefined)
      : [];

    for (const method of HTTP_METHODS) {
      const operation = pathItem[method];
      if (!isRecord(operation)) continue;

      const operationParameters = Array.isArray(operation['parameters'])
        ? operation['parameters'].map(toParameterCandidate).filter((p): p is OpenAPIParameterCandidate => p !== undefined)
        : [];
      const merged = new Map<string, OpenAPIParameterCandidate>();
      for (const parameter of [...pathLevelParameters, ...operationParameters]) {
        merged.set(`${parameter.in}:${parameter.name}`, parameter);
      }

      const { schema: requestBodySchema, required: requestBodyRequired } = requestBodyOf(operation['requestBody']);

      const issues: string[] = [];
      if (operation['requestBody'] !== undefined && requestBodySchema === undefined) issues.push('Only application/json request bodies are supported.');
      const responseSchemas: Record<string, JsonSchemaLike> = {};
      if (isRecord(operation['responses'])) {
        for (const [status, response] of Object.entries(operation['responses'])) {
          if (!/^(2[0-9X]{2}|default)$/.test(status) || !isRecord(response)) continue;
          const body = requestBodyOf(response);
          if (body.schema) responseSchemas[status] = body.schema;
        }
      }
      candidates.push({
        responseSchemas,
        issues,
        method,
        path,
        operationId: typeof operation['operationId'] === 'string' ? operation['operationId'] : undefined,
        summary: typeof operation['summary'] === 'string' ? operation['summary'] : undefined,
        description: typeof operation['description'] === 'string' ? operation['description'] : undefined,
        parameters: Array.from(merged.values()),
        requestBodySchema,
        requestBodyRequired,
        tags: Array.isArray(operation['tags']) ? operation['tags'].filter((tag): tag is string => typeof tag === 'string') : undefined,
      });
    }
  }
  return candidates;
}
