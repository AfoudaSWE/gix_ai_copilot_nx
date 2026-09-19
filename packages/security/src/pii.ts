import type { DataClassification } from '@gixcopilot/protocol';

export type { DataClassification } from '@gixcopilot/protocol';

/** One field an application has identified as sensitive (Section 53), plus how it may be
 * exposed. Deliberately per-field, not a whole-object policy - Section 52's "practical SDK
 * primitives, not a compliance framework." */
export interface SensitiveFieldSpec {
  readonly field: string;
  readonly classification: DataClassification;
  /** Defaults to `defaultRedactor` when omitted - domain-specific masking (Section 54's "do
   * not hardcode masking semantics for every domain") is the application's to provide. */
  readonly redact?: (value: unknown) => unknown;
}

/** Keeps the first and last two characters of a string, masking the middle - a reasonable,
 * generic default (Section 54's example: `A12345678` -> `A******78`). Non-string values are
 * replaced outright, since there is no generic partial-masking strategy for them. */
export function defaultRedactor(value: unknown): unknown {
  if (typeof value !== 'string') return '[REDACTED]';
  if (value.length <= 4) return '*'.repeat(value.length);
  return value.slice(0, 1) + '*'.repeat(value.length - 3) + value.slice(-2);
}

function getPath(data: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (typeof acc !== 'object' || acc === null) return undefined;
    return (acc as Record<string, unknown>)[key];
  }, data);
}

function setPath(data: Record<string, unknown>, path: string, value: unknown): Record<string, unknown> {
  const segments = path.split('.');
  const [head, ...rest] = segments;
  if (head === undefined || !(head in data)) return data;
  if (rest.length === 0) {
    return { ...data, [head]: value };
  }
  const nested = data[head];
  if (typeof nested !== 'object' || nested === null) return data;
  return { ...data, [head]: setPath(nested as Record<string, unknown>, rest.join('.'), value) };
}

/**
 * Applies every matching field spec's redaction to a shallow/dotted-path copy of `data`
 * (Section 54). Never mutates the input - callers (context resolution, tool-result filtering)
 * must be able to keep the original for internal use while sending only the redacted copy to
 * the model (Section 55-56).
 */
export function redactFields<T extends Record<string, unknown>>(
  data: T,
  specs: readonly SensitiveFieldSpec[],
): T {
  let result: Record<string, unknown> = data;
  for (const spec of specs) {
    const current = getPath(result, spec.field);
    if (current === undefined) continue;
    const redactor = spec.redact ?? defaultRedactor;
    result = setPath(result, spec.field, redactor(current));
  }
  return result as T;
}

/** A general data policy boundary (Section 55-57): decides what a model/UI may see for a
 * given piece of data. `createFieldRedactionDataPolicy` is the field-spec-driven
 * implementation this package ships; an application may implement `DataPolicy` directly for
 * more elaborate rules. */
export interface DataPolicy {
  redact(data: unknown): unknown;
  /** Filters serialized context/text. Supply a custom implementation for free prose. */
  redactText?(text: string): string;
}

export function createFieldRedactionDataPolicy(specs: readonly SensitiveFieldSpec[]): DataPolicy {
  const safeSpecs = specs.map((spec) => spec.classification === 'secret' && !spec.redact
    ? { ...spec, redact: () => '[REDACTED]' } : spec);
  function redact(data: unknown): unknown {
    if (Array.isArray(data)) return data.map(redact);
    if (typeof data !== 'object' || data === null) return data;
    const children = Object.fromEntries(Object.entries(data).map(([key, value]) => [key, redact(value)]));
    return redactFields(children, safeSpecs);
  }
  return {
    redact,
    redactText(text) {
      // Phase 4 context is formatted JSON inside text blocks. Match complete JSON string
      // values, including escapes, without interpreting their content as instructions.
      return text.replace(/("(?:[^"\\]|\\.)*")\s*:\s*("(?:[^"\\]|\\.)*")/g, (match, key: string, value: string) => {
        const field: unknown = JSON.parse(key);
        const spec = safeSpecs.find((candidate) => candidate.field.split('.').at(-1) === field);
        return spec ? `${key}: ${JSON.stringify((spec.redact ?? defaultRedactor)(JSON.parse(value)))}` : match;
      });
    },
  };
}
