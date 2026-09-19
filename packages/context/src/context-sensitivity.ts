/**
 * Context sensitivity metadata (Section 30). This is metadata/foundation only - Phase 7
 * owns the full enterprise security/PII policy system (see the security skill). The default
 * engine policy (Section 27, `context-engine.ts`) uses this only to exclude `restricted`
 * items by default; it is not an authorization mechanism and must never be treated as one.
 */
export type ContextSensitivity = 'public' | 'internal' | 'sensitive' | 'restricted';

export const CONTEXT_SENSITIVITIES: readonly ContextSensitivity[] = [
  'public',
  'internal',
  'sensitive',
  'restricted',
];

export const DEFAULT_CONTEXT_SENSITIVITY: ContextSensitivity = 'internal';

export function isContextSensitivity(value: unknown): value is ContextSensitivity {
  return typeof value === 'string' && (CONTEXT_SENSITIVITIES as readonly string[]).includes(value);
}
