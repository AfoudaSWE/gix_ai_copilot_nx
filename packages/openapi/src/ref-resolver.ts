/**
 * Resolves local `$ref` pointers (`#/components/...`) in place, returning a new,
 * fully-dereferenced document (Section 13). Only local references are supported - an
 * external `$ref` (a different file or a URL) is left unresolved and reported as an error by
 * the caller downstream (`validator.ts`) rather than silently followed, since resolving an
 * external reference would reintroduce the same "which URLs may this fetch" question
 * `loader.ts` already draws a hard line around (Section 10). Cycle-safe: a `$ref` chain that
 * loops back on itself throws a clear error instead of recursing forever (Section 13's
 * "avoid uncontrolled recursive resolution").
 */
export class UnresolvableReferenceError extends Error {
  constructor(ref: string) {
    super(`Cannot resolve "${ref}" - only local "#/..." references are supported.`);
  }
}

export class CircularReferenceError extends Error {
  constructor(chain: readonly string[]) {
    super(`Circular $ref chain: ${chain.join(' -> ')}`);
  }
}

function pointerSegments(ref: string): readonly string[] {
  if (!ref.startsWith('#/')) throw new UnresolvableReferenceError(ref);
  return ref
    .slice(2)
    .split('/')
    .map((segment) => segment.replace(/~1/g, '/').replace(/~0/g, '~'));
}

function readPointer(root: unknown, ref: string): unknown {
  const segments = pointerSegments(ref);
  let current: unknown = root;
  for (const segment of segments) {
    if (typeof current !== 'object' || current === null) throw new UnresolvableReferenceError(ref);
    if (!Object.hasOwn(current, segment)) throw new UnresolvableReferenceError(ref);
    current = (current as Record<string, unknown>)[segment];
  }
  if (current === undefined) throw new UnresolvableReferenceError(ref);
  return current;
}

function resolveValue(root: unknown, value: unknown, chain: readonly string[]): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => resolveValue(root, item, chain));
  }
  if (typeof value !== 'object' || value === null) return value;

  const record = value as Record<string, unknown>;
  const ref = record['$ref'];
  if (typeof ref === 'string') {
    if (chain.includes(ref)) throw new CircularReferenceError([...chain, ref]);
    if (Object.keys(record).some((key) => !['$ref', 'summary', 'description'].includes(key))) throw new Error('Reference siblings with validation constraints are unsupported.');
    const target = readPointer(root, ref);
    return resolveValue(root, target, [...chain, ref]);
  }

  const resolved: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const [key, child] of Object.entries(record)) {
    resolved[key] = resolveValue(root, child, chain);
  }
  return resolved;
}

export function resolveLocalRefs(document: unknown): unknown {
  return resolveValue(document, document, []);
}
