/**
 * Safe telemetry (Section 14-15). Production default is `redacted`; `off` records nothing;
 * `metadata-only` keeps shapes/ids/counts/timings but strips every payload body;
 * `development-verbose` keeps payloads but STILL masks secret-shaped keys (Section 59: a raw
 * developer view must still protect secrets).
 */
export type TelemetryMode = 'off' | 'metadata-only' | 'redacted' | 'development-verbose';

export const DEFAULT_TELEMETRY_MODE: TelemetryMode = 'redacted';

export const REDACTED = '[REDACTED]';

/** Duck-typed against `@gixcopilot/security`'s `DataPolicy` so this package never depends on it. */
export interface RedactionDataPolicy {
  redact(data: unknown): unknown;
  redactText?(text: string): string;
}

export interface RedactionPolicyOptions {
  readonly mode?: TelemetryMode;
  /** Extra key names (case-insensitive substring match) treated as secrets. */
  readonly extraSecretKeys?: readonly string[];
  /** Extra key names treated as PII (masked under `redacted`, kept under verbose). */
  readonly extraPiiKeys?: readonly string[];
  readonly maxStringLength?: number;
  readonly maxDepth?: number;
  /** A Phase 7 `DataPolicy` applied first, when the host already has one. */
  readonly dataPolicy?: RedactionDataPolicy;
}

export interface RedactionPolicy {
  readonly mode: TelemetryMode;
  /** Redacts a structured payload per mode. Returns `undefined` under `off`/`metadata-only`. */
  payload(value: unknown): unknown;
  /** Redacts free text per mode. Returns `undefined` under `off`/`metadata-only`. */
  text(value: string | undefined): string | undefined;
  /** Always masks secret-shaped keys regardless of mode - for values that must survive (e.g. attributes). */
  scrub(value: unknown): unknown;
  readonly capturesPayloads: boolean;
}

const SECRET_KEY_PATTERNS = [
  'password',
  'passwd',
  'secret',
  'token',
  'apikey',
  'api_key',
  'api-key',
  'authorization',
  'auth',
  'cookie',
  'credential',
  'private_key',
  'privatekey',
  'session_id',
  'sessionid',
  'ssn',
  'social_security',
  'card_number',
  'cardnumber',
  'cvv',
];

// Plain `name` is deliberately absent: in this codebase it is overwhelmingly a tool/agent/
// workflow identifier, not a person - only compound identity keys are treated as PII.
const PII_KEY_PATTERNS = [
  'email',
  'phone',
  'mobile',
  'address',
  'birthdate',
  'dateofbirth',
  'date_of_birth',
  'firstname',
  'first_name',
  'lastname',
  'last_name',
  'surname',
  'fullname',
  'full_name',
];

const SECRET_VALUE_PATTERNS: readonly RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{8,}\b/g, // OpenAI-style API keys
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, // JWT
  /\bAKIA[0-9A-Z]{16}\b/g, // AWS access key id
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, // GitHub tokens
];

const PII_VALUE_PATTERNS: readonly RegExp[] = [
  /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, // email
  /\b(?:\+?\d{1,3}[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g, // phone
  /\b\d{3}-\d{2}-\d{4}\b/g, // US SSN
  /\b(?:\d[ -]?){13,16}\b/g, // card-number-like digit runs
];

function matchesAny(key: string, patterns: readonly string[]): boolean {
  const normalized = key.toLowerCase();
  return patterns.some((pattern) => normalized.includes(pattern.toLowerCase()));
}

const TOKEN_COUNT_KEYS = new Set(['inputtokens', 'outputtokens', 'totaltokens', 'budgettokens', 'usedtokens', 'remainingtokens', 'estimatedtokens', 'maxoutputtokens', 'maxcontexttokens']);

function isSecretKey(key: string, extra: readonly string[], value?: unknown): boolean {
  // Guard the short generic 'auth' pattern against false positives like 'author'.
  const normalized = key.toLowerCase();
  // A boolean can never carry a secret (`authenticated: true`). A number under a "token" or
  // "auth" key is a count (`copilot.tokens.input`, a retrieval's `authorizedCount`), never a
  // credential. Numeric passwords, cvv, ssn and card numbers stay masked.
  if (typeof value === 'boolean') return false;
  if (typeof value === 'number' && (TOKEN_COUNT_KEYS.has(normalized) || normalized.includes('token') || normalized.includes('auth'))) return false;
  if (normalized === 'author' || normalized === 'authors') return false;
  return matchesAny(key, SECRET_KEY_PATTERNS) || matchesAny(key, extra);
}

function isPiiKey(key: string, extra: readonly string[]): boolean {
  const normalized = key.toLowerCase();
  if (normalized === 'dob') return true;
  return matchesAny(key, PII_KEY_PATTERNS) || matchesAny(key, extra);
}

export function maskSecretsInText(text: string): string {
  let out = text;
  for (const pattern of SECRET_VALUE_PATTERNS) out = out.replace(pattern, REDACTED);
  return out;
}

export function maskPiiInText(text: string): string {
  let out = text;
  for (const pattern of PII_VALUE_PATTERNS) out = out.replace(pattern, REDACTED);
  return out;
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…[truncated ${text.length - max} chars]` : text;
}

export function createRedactionPolicy(options: RedactionPolicyOptions = {}): RedactionPolicy {
  const mode = options.mode ?? DEFAULT_TELEMETRY_MODE;
  const extraSecret = options.extraSecretKeys ?? [];
  const extraPii = options.extraPiiKeys ?? [];
  const maxStringLength = options.maxStringLength ?? (mode === 'development-verbose' ? 20_000 : 2_000);
  const maxDepth = options.maxDepth ?? 12;
  const capturesPayloads = mode === 'redacted' || mode === 'development-verbose';
  const maskPii = mode !== 'development-verbose';

  function walk(value: unknown, depth: number, keyPath: string | undefined): unknown {
    if (depth > maxDepth) return '[depth-limit]';
    if (typeof value === 'string') {
      let text = maskSecretsInText(value);
      if (maskPii) text = maskPiiInText(text);
      return truncate(text, maxStringLength);
    }
    if (typeof value === 'number' || typeof value === 'boolean' || value === null || value === undefined) return value;
    if (typeof value === 'bigint') return value.toString();
    if (typeof value === 'function' || typeof value === 'symbol') return undefined;
    if (value instanceof Date) return value.toISOString();
    if (Array.isArray(value)) return value.map((entry) => walk(entry, depth + 1, keyPath));
    if (typeof value === 'object') {
      const out: Record<string, unknown> = {};
      for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
        if (isSecretKey(key, extraSecret, entry)) {
          out[key] = REDACTED;
        } else if (maskPii && isPiiKey(key, extraPii)) {
          out[key] = REDACTED;
        } else {
          out[key] = walk(entry, depth + 1, key);
        }
      }
      return out;
    }
    return '[unsupported-value]';
  }

  function scrubOnly(value: unknown, depth: number): unknown {
    if (depth > maxDepth) return '[depth-limit]';
    if (typeof value === 'string') return maskSecretsInText(value);
    if (Array.isArray(value)) return value.map((entry) => scrubOnly(entry, depth + 1));
    if (value !== null && typeof value === 'object' && !(value instanceof Date)) {
      const out: Record<string, unknown> = {};
      for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
        out[key] = isSecretKey(key, extraSecret, entry) ? REDACTED : scrubOnly(entry, depth + 1);
      }
      return out;
    }
    return value;
  }

  return {
    mode,
    capturesPayloads,
    payload(value) {
      if (!capturesPayloads) return undefined;
      const pre = options.dataPolicy ? options.dataPolicy.redact(value) : value;
      return walk(pre, 0, undefined);
    },
    text(value) {
      if (!capturesPayloads || value === undefined) return undefined;
      const pre = options.dataPolicy?.redactText ? options.dataPolicy.redactText(value) : value;
      return walk(pre, 0, undefined) as string;
    },
    scrub(value) {
      return scrubOnly(value, 0);
    },
  };
}
