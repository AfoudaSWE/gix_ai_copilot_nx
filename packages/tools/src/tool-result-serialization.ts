/**
 * Bounds and sanitizes a tool's raw output before it becomes part of a `tool.completed`
 * event or a `tool_result` content part (Section 54-56). Mirrors the general approach
 * `@gixcopilot/context`'s serializer uses for arbitrary application values (Date/undefined/
 * functions/circular references), reimplemented locally rather than imported - tool results
 * and application context are different domains that happen to share a serialization
 * concern, and `@gixcopilot/tools` must not depend on `@gixcopilot/context` (see
 * project-architecture's package-boundary rule).
 */
export interface SerializeToolResultOptions {
  /** Defaults to 32 KiB - generous enough for typical structured results, small enough that
   * one runaway tool cannot blow the model's context window (Section 54). */
  readonly maxResultBytes?: number;
}

const DEFAULT_MAX_RESULT_BYTES = 32 * 1024;

function jsonSafeReplacer(): (key: string, value: unknown) => unknown {
  const seen = new WeakSet<object>();
  return (_key, value) => {
    if (value instanceof Date) return value.toISOString();
    if (typeof value === 'bigint') return value.toString();
    if (typeof value === 'function') return '[Function]';
    if (typeof value === 'undefined') return undefined;
    if (typeof value === 'object' && value !== null) {
      if (seen.has(value)) return '[Circular]';
      seen.add(value);
    }
    return value;
  };
}

/**
 * Produces a JSON-safe, size-bounded value. Never throws on an unusual input (Date,
 * function, circular reference, class instance) - it degrades to a safe stand-in instead,
 * since a tool result reaching this function has already succeeded and must not be turned
 * into a fresh failure by a serialization edge case.
 */
export function serializeToolResult(
  data: unknown,
  options: SerializeToolResultOptions = {},
): { readonly value: unknown; readonly truncated: boolean } {
  const maxBytes = options.maxResultBytes ?? DEFAULT_MAX_RESULT_BYTES;
  let json: string;
  try {
    json = JSON.stringify(data, jsonSafeReplacer()) ?? 'null';
  } catch {
    return { value: '[Unserializable tool result]', truncated: false };
  }

  if (json.length <= maxBytes) {
    return { value: JSON.parse(json) as unknown, truncated: false };
  }

  return {
    value: {
      truncated: true,
      preview: json.slice(0, maxBytes),
    },
    truncated: true,
  };
}
