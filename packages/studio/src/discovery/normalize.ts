import type { ApiOperation, ApiSource, ApiSourceKind, NormalizedApiOperation, OperationConfidence } from './model.js';

/** Source precedence (§17): lower is stronger. */
const RANK: Readonly<Record<ApiSourceKind, number>> = { openapi: 0, swagger: 1, 'backend-route': 2, postman: 3, 'frontend-client': 4 };
const SCHEMA_SOURCES: ReadonlySet<ApiSourceKind> = new Set(['openapi', 'swagger']);

/**
 * The identity of an operation across sources: method + path with the `/api` and version
 * prefixes removed and every parameter name erased, so `/api/v1/users/:userId` and
 * `/users/{id}` are the same operation.
 */
export function canonicalOperationKey(method: string, path: string): string {
  const canonical = path
    .toLowerCase()
    .replace(/\/+$/, '')
    .replace(/^\/api(?=\/|$)/, '')
    .replace(/^\/v\d+(?=\/|$)/, '')
    .replace(/\{[^}]*\}|:[a-z_]\w*/g, '{}');
  return `${method.toUpperCase()} ${canonical || '/'}`;
}

function inputFields(operation: ApiOperation): string[] | undefined {
  const properties = (operation.input as { properties?: Record<string, unknown> } | undefined)?.properties;
  if (!properties) return undefined;
  const body = properties['body'] as { properties?: Record<string, unknown> } | undefined;
  const params = Object.keys(properties).filter((name) => name !== 'body');
  return [...params.map(() => '<param>'), ...Object.keys(body?.properties ?? {})].sort();
}

function inputContract(operation: ApiOperation): string | undefined {
  if (!operation.input) return undefined;
  // Only path parameter names are interchangeable, and only at the same path position.
  const pathNames = [...operation.path.matchAll(/\{([^}]+)\}|:([a-z_]\w*)/gi)].map((match) => match[1] ?? match[2]);
  const nameOf = (name: string): string => {
    const index = pathNames.indexOf(name);
    return index < 0 ? name : `<path:${index}>`;
  };
  const schema = { ...operation.input };
  const properties = schema['properties'];
  if (typeof properties === 'object' && properties !== null && !Array.isArray(properties)) {
    schema['properties'] = Object.fromEntries(Object.entries(properties).map(([name, value]) => [nameOf(name), value]));
  }
  if (Array.isArray(schema['required'])) schema['required'] = schema['required'].map((name: unknown) => typeof name === 'string' ? nameOf(name) : name);
  const canonicalize = (value: unknown, key = ''): unknown => {
    if (Array.isArray(value)) {
      const entries = value.map((entry) => canonicalize(entry));
      return ['required', 'enum', 'type'].includes(key) ? entries.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))) : entries;
    }
    if (typeof value === 'object' && value !== null) {
      return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([name, entry]) => [name, canonicalize(entry, name)]));
    }
    return value;
  };
  return JSON.stringify(canonicalize(schema));
}

function confidenceOf(kinds: ReadonlySet<ApiSourceKind>, conflicts: readonly string[]): OperationConfidence {
  if (conflicts.length > 0) return 'review';
  if ([...kinds].some((kind) => SCHEMA_SOURCES.has(kind))) return 'high';
  if (kinds.has('backend-route') && kinds.size > 1) return 'high';
  if (kinds.has('backend-route') || kinds.has('postman')) return 'medium';
  return 'review';
}

/**
 * Merges every discovered operation into one deduplicated list (§17, §21). The strongest
 * source supplies the contract. Schema-bearing sources that disagree about the request contract
 * produce a conflict, and the operation drops to `review`.
 */
export function normalizeApiOperations(apis: readonly ApiSource[]): NormalizedApiOperation[] {
  const groups = new Map<string, ApiOperation[]>();
  for (const operation of apis.flatMap((source) => source.operations)) {
    const key = canonicalOperationKey(operation.method, operation.path);
    groups.set(key, [...(groups.get(key) ?? []), operation]);
  }
  return [...groups]
    .map(([key, operations]): NormalizedApiOperation => {
      const ranked = [...operations].sort((a, b) => RANK[a.sourceKind] - RANK[b.sourceKind]);
      const primary = ranked[0] as ApiOperation;
      const conflicts: string[] = [];
      const withSchema = ranked.filter((operation) => SCHEMA_SOURCES.has(operation.sourceKind) || operation.sourceKind === 'postman');
      const reference = withSchema[0];
      const referenceFields = reference ? inputFields(reference)?.join(',') : undefined;
      const referenceContract = reference ? inputContract(reference) : undefined;
      for (const other of withSchema.slice(1)) {
        const fields = inputFields(other)?.join(',');
        if (reference && referenceFields !== undefined && fields !== undefined && fields !== referenceFields && (SCHEMA_SOURCES.has(other.sourceKind) || fields !== '')) {
          conflicts.push(`Request fields differ: ${reference.sourceKind} (${reference.file}) has [${referenceFields}], ${other.sourceKind} (${other.file}) has [${fields}].`);
        } else if (reference && referenceContract !== undefined && other.input && inputContract(other) !== referenceContract) {
          conflicts.push(`Request contracts differ: ${reference.sourceKind} (${reference.file}) and ${other.sourceKind} (${other.file}) declare incompatible schemas or parameter placement.`);
        }
      }
      const operationIds = [...new Set(ranked.filter((operation) => SCHEMA_SOURCES.has(operation.sourceKind) && operation.operationId).map((operation) => operation.operationId))];
      if (operationIds.length > 1) conflicts.push(`Different operationIds: ${operationIds.join(', ')}.`);
      const permissions = [...new Set(ranked.flatMap((operation) => operation.permissions))];
      const authentication = ranked.find((operation) => operation.authentication)?.authentication;
      return {
        key,
        method: primary.method,
        path: primary.path,
        ...(primary.operationId ? { operationId: primary.operationId } : {}),
        ...((primary.summary ?? ranked.find((operation) => operation.summary)?.summary) ? { summary: primary.summary ?? ranked.find((operation) => operation.summary)?.summary } : {}),
        ...(primary.input ? { input: primary.input } : {}),
        ...(primary.output ? { output: primary.output } : {}),
        ...(authentication ? { authentication } : {}),
        permissions,
        sources: ranked.map((operation) => ({ kind: operation.sourceKind, file: operation.file, ...(operation.line ? { line: operation.line } : {}), ...(operation.operationId ? { operationId: operation.operationId } : {}) })),
        primary: { ...primary, permissions, ...(authentication ? { authentication } : {}) },
        confidence: confidenceOf(new Set(ranked.map((operation) => operation.sourceKind)), conflicts),
        conflicts,
      };
    })
    .sort((a, b) => a.key.localeCompare(b.key));
}
