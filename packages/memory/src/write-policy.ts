import type { MemoryPutInput } from './store.js';

export interface MemoryWriteDecision {
  readonly allowed: boolean;
  readonly reason?: string;
}

/**
 * Not everything the model/application says should become durable memory (Section 100-102).
 * A store calls this before every `put()`; the default below rejects values that look like
 * credentials, and an application may supply a stricter or domain-specific policy (Section
 * 101's "explicit confirmation" / "never persist" categories are the caller's to implement on
 * top of this hook - this package only provides the mandatory floor).
 */
export interface MemoryWritePolicy {
  evaluate(input: MemoryPutInput): MemoryWriteDecision | Promise<MemoryWriteDecision>;
}

/**
 * Deliberately conservative pattern list (Section 102): private key blocks, OpenAI/Anthropic-
 * shaped API keys, bearer tokens, and `key: value`/`key=value` pairs whose key name reads as a
 * credential. False positives (rejecting a legitimate memory write) are an acceptable cost for
 * never durably storing a secret by accident - the caller can always supply a narrower policy.
 */
const SENSITIVE_PATTERNS: readonly RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\b(?:sk|pk|rk)-[A-Za-z0-9_-]{10,}\b/,
  /\bBearer\s+[A-Za-z0-9._-]{10,}/i,
  /\b(?:password|passwd|api[_-]?key|apikey|access[_-]?token|authorization|secret|client[_-]?secret)["']?\s*[:=]\s*\S+/i,
  /\b\d{3}-\d{2}-\d{4}\b/,
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
];

function stringify(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value) ?? '';
  } catch {
    return String(value);
  }
}

export function containsSensitiveContent(value: unknown): boolean {
  const text = stringify(value);
  return SENSITIVE_PATTERNS.some((pattern) => pattern.test(text));
}

export function createDefaultMemoryWritePolicy(): MemoryWritePolicy {
  return {
    evaluate(input: MemoryPutInput): MemoryWriteDecision {
      if (containsSensitiveContent(input.value) || containsSensitiveContent(input.metadata)) {
        return {
          allowed: false,
          reason:
            'Refusing to persist a memory value that looks like a credential or secret (passwords, API keys, ' +
            'access tokens, and private keys are never durably stored by default - Section 102).',
        };
      }
      return { allowed: true };
    },
  };
}

/** A policy that never rejects a write - only for tests/examples that intentionally exercise
 * unrestricted storage; production code should keep (or extend) the default policy. */
export function createPermissiveMemoryWritePolicy(): MemoryWritePolicy {
  return { evaluate: (): MemoryWriteDecision => ({ allowed: true }) };
}
