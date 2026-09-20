import { toToolNameSegment } from '@gixcopilot/tools';
import type { HttpMethod, OpenAPIOperationCandidate, RegistrationConflict } from './types.js';

/** The key an `OpenAPIOperationOverride` is looked up by (Section 42's "identified by
 * `operationId` when present, else `\"METHOD /path\"`, exactly as discovered"). */
export function operationKey(candidate: OpenAPIOperationCandidate): string {
  return candidate.operationId ?? `${candidate.method.toUpperCase()} ${candidate.path}`;
}

function isParamSegment(segment: string): boolean {
  return segment.startsWith('{') && segment.endsWith('}');
}

function pathSegmentsOf(path: string): readonly string[] {
  return path.split('/').filter((segment) => segment.length > 0);
}

/** Method-based verb used when the operation addresses a single resource by id (the path's
 * last segment is a `{param}`), e.g. `GET /applications/{id}` -> `getById`. */
function verbForResourceById(method: HttpMethod): string {
  switch (method) {
    case 'get':
      return 'getById';
    case 'put':
    case 'patch':
      return 'update';
    case 'delete':
      return 'remove';
    case 'post':
      return 'create';
    case 'head':
    case 'options':
    case 'trace':
      return method;
  }
}

/** Method-based verb used when the operation addresses a collection (the path's last segment
 * is literal, with no preceding `{param}`), e.g. `GET /applications` -> `list`. */
function verbForCollection(method: HttpMethod): string {
  switch (method) {
    case 'get':
      return 'list';
    case 'post':
      return 'create';
    case 'put':
    case 'patch':
      return 'update';
    case 'delete':
      return 'removeAll';
    case 'head':
    case 'options':
    case 'trace':
      return method;
  }
}

/**
 * Deterministic fallback naming (Section 17) for operations with no usable `operationId`.
 * Literal path segments become nested namespace segments (e.g. `/orgs/{id}/teams` ->
 * `orgs.teams`); the final segment becomes an explicit action verb: when the path ends on a
 * literal sub-resource **action** reached through a specific instance via `POST` (e.g.
 * `POST /applications/{id}/assign`), that literal segment IS the verb (`assign`) rather than a
 * generic one, matching Section 19's `vas.applications.assign` example. This is deliberately
 * restricted to `POST`: a trailing literal segment after a `{param}` is ambiguous between an
 * RPC-style action (a verb - conventionally `POST`, e.g. `assign`/`archive`) and a nested
 * collection (a noun, e.g. `members`, reachable by any method) - treating every method the
 * same way would make `GET .../members` and `POST .../members` collide on the same generated
 * name (`list` vs `create` on the same collection must stay distinguishable). For every other
 * method, and whenever the path ends on a literal with no preceding `{param}`, the verb is
 * derived from the HTTP method instead (`getById`/`list`/`create`/`update`/`remove`/
 * `removeAll`). This is stable across regenerations as long as the path shape and method are
 * unchanged (Section 17's "avoid unstable names" - never derived from `summary`/`description`,
 * which are free text an API owner might reword at any time).
 *
 * Known simplification: a `POST` on a trailing literal after a `{param}` is always treated as
 * an RPC-style action (e.g. `orgs.members`), even when it is really "create a member in this
 * nested collection" rather than a named verb - path shape alone cannot distinguish the two.
 * This does not silently mis-register anything: if two *different* operations across a
 * document happen to derive the same name, `detectNamingConflicts` (Section 18) catches it
 * downstream and the caller resolves it via namespace/override/error, never a silent overwrite.
 */
export function deriveFallbackName(candidate: OpenAPIOperationCandidate): string {
  const segments = pathSegmentsOf(candidate.path);
  const literalSegments = segments.filter((segment) => !isParamSegment(segment));
  const lastSegment = segments[segments.length - 1];
  const lastIsParam = lastSegment !== undefined && isParamSegment(lastSegment);

  let resourceSegments: readonly string[];
  let action: string;
  if (lastIsParam) {
    resourceSegments = literalSegments;
    action = verbForResourceById(candidate.method);
  } else {
    const hasPrecedingParam = segments.slice(0, -1).some(isParamSegment);
    if (hasPrecedingParam && lastSegment !== undefined && candidate.method === 'post') {
      resourceSegments = literalSegments.slice(0, -1);
      action = toToolNameSegment(lastSegment);
    } else {
      resourceSegments = literalSegments;
      action = verbForCollection(candidate.method);
    }
  }

  const resource = resourceSegments.length > 0 ? resourceSegments : ['root'];
  return [...resource, action].map(toToolNameSegment).join('.');
}

/**
 * Full naming pipeline for one operation (Section 16-19): an explicit per-operation `name`
 * override always wins; otherwise a valid `operationId` is preferred; otherwise the
 * deterministic fallback is used. An optional `namespace` (Section 19, e.g. `"vas"`) is
 * prepended to either case, producing e.g. `vas.applications.assign` or `vas.getApplication`.
 */
export function deriveToolName(
  candidate: OpenAPIOperationCandidate,
  options: { readonly namespace?: string; readonly overrideName?: string } = {},
): string {
  const leaf =
    options.overrideName !== undefined
      ? toToolNameSegment(options.overrideName)
      : candidate.operationId !== undefined && candidate.operationId.length > 0
        ? toToolNameSegment(candidate.operationId)
        : deriveFallbackName(candidate);
  return options.namespace !== undefined ? `${toToolNameSegment(options.namespace)}.${leaf}` : leaf;
}

/**
 * Detects tool-name collisions across a batch of generated names (Section 18): two or more
 * operations resolving to the same name is reported, never silently overwritten - the caller
 * (`tool-generator.ts`) decides whether that is a hard error, a skip, or resolved by an
 * explicit namespace/override.
 */
export function detectNamingConflicts(
  entries: readonly { readonly name: string; readonly operation: string }[],
): readonly RegistrationConflict[] {
  const byName = new Map<string, string[]>();
  for (const entry of entries) {
    const operations = byName.get(entry.name) ?? [];
    operations.push(entry.operation);
    byName.set(entry.name, operations);
  }
  const conflicts: RegistrationConflict[] = [];
  for (const [name, operations] of byName) {
    if (operations.length > 1) conflicts.push({ name, operations });
  }
  return conflicts;
}
