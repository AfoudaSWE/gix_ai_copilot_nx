/**
 * The controlled serialization boundary application objects must pass through before
 * reaching a model (Section 21). Never `JSON.stringify` an arbitrary application object
 * directly - this module is the single place that decides what is safe to include and what
 * gets normalized/omitted, with every decision recorded as a warning rather than silently
 * dropped (Section 60, 69).
 */
export interface ContextSerializerOptions {
  /** Longest a single string value may be before truncation. Default 2000. */
  readonly maxStringLength?: number;
  /** Longest an array may be before truncation. Default 50. */
  readonly maxArrayLength?: number;
  /** Deepest an object/array may nest before being cut off. Default 6. */
  readonly maxDepth?: number;
}

export interface SerializedValue {
  /** Stable, pretty-printed JSON text - the model-facing representation of the value. */
  readonly text: string;
  /** True if any string/array/depth limit was applied while producing `text`. */
  readonly truncated: boolean;
  /** Human-readable notes on what was normalized or omitted, e.g. `'function-omitted'`. */
  readonly warnings: readonly string[];
}

export interface ContextSerializer {
  serialize(value: unknown): SerializedValue;
}

const TRUNCATION_MARKER = '…(truncated)';

function isPlainObject(value: object): value is Record<string, unknown> {
  const proto = Object.getPrototypeOf(value) as object | null;
  return proto === Object.prototype || proto === null;
}

function looksLikeDomNode(value: object): boolean {
  return 'nodeType' in value && typeof (value as { nodeType?: unknown }).nodeType === 'number';
}

interface SerializeState {
  readonly maxStringLength: number;
  readonly maxArrayLength: number;
  readonly maxDepth: number;
  readonly warnings: string[];
  truncated: boolean;
  readonly ancestors: unknown[];
}

function truncateString(value: string, state: SerializeState): string {
  if (value.length <= state.maxStringLength) return value;
  state.truncated = true;
  state.warnings.push('string-truncated');
  return value.slice(0, state.maxStringLength) + TRUNCATION_MARKER;
}

function toSafe(value: unknown, depth: number, state: SerializeState): unknown {
  if (value === undefined) return undefined;
  if (value === null) return null;

  const type = typeof value;
  if (type === 'string') return truncateString(value as string, state);
  if (type === 'number' || type === 'boolean') return value;
  if (type === 'bigint') return `${(value as bigint).toString()}n`;
  if (type === 'function') {
    state.warnings.push('function-omitted');
    return '[Function omitted]';
  }
  if (type === 'symbol') {
    state.warnings.push('symbol-omitted');
    return '[Symbol omitted]';
  }

  // type === 'object' from here on - TS narrows `value` via the `type` alias above.
  const obj = value;

  if (value instanceof Date) {
    return value.toISOString();
  }
  if (value instanceof RegExp) {
    return value.toString();
  }
  if (looksLikeDomNode(obj)) {
    state.warnings.push('dom-node-omitted');
    return '[DOM node omitted]';
  }

  if (state.ancestors.includes(value)) {
    state.warnings.push('circular-reference');
    return '[Circular]';
  }

  if (depth >= state.maxDepth) {
    state.truncated = true;
    state.warnings.push('max-depth-exceeded');
    return '[MaxDepthExceeded]';
  }

  state.ancestors.push(value);
  try {
    if (Array.isArray(value)) {
      const limited = value.length > state.maxArrayLength;
      if (limited) {
        state.truncated = true;
        state.warnings.push('array-truncated');
      }
      const items = limited ? value.slice(0, state.maxArrayLength) : value;
      return items.map((item) => toSafe(item, depth + 1, state));
    }

    if (typeof (obj as { toJSON?: unknown }).toJSON === 'function') {
      const toJSON = (obj as { toJSON: () => unknown }).toJSON.bind(obj);
      return toSafe(toJSON(), depth + 1, state);
    }

    if (!isPlainObject(obj)) {
      state.warnings.push('class-instance-normalized');
    }

    const result: Record<string, unknown> = {};
    for (const [key, entryValue] of Object.entries(obj as Record<string, unknown>)) {
      const safeEntry = toSafe(entryValue, depth + 1, state);
      if (safeEntry !== undefined) result[key] = safeEntry;
    }
    return result;
  } finally {
    state.ancestors.pop();
  }
}

/**
 * The default, dependency-free serializer. Handles `undefined`, `Date`, `bigint`, circular
 * references, functions, DOM-like nodes, class instances, and oversized strings/arrays
 * deterministically (Section 21, 69) rather than throwing or producing invalid JSON.
 */
export function createDefaultContextSerializer(
  options: ContextSerializerOptions = {},
): ContextSerializer {
  const maxStringLength = options.maxStringLength ?? 2000;
  const maxArrayLength = options.maxArrayLength ?? 50;
  const maxDepth = options.maxDepth ?? 6;

  return {
    serialize(value: unknown): SerializedValue {
      const state: SerializeState = {
        maxStringLength,
        maxArrayLength,
        maxDepth,
        warnings: [],
        truncated: false,
        ancestors: [],
      };
      const safe = toSafe(value, 0, state);
      const text = safe === undefined ? 'null' : JSON.stringify(safe, null, 2);
      return { text, truncated: state.truncated, warnings: state.warnings };
    },
  };
}
