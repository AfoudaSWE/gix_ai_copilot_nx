import { redactSecrets } from '../apply/secret-scan.js';

const SECRET_KEY = /(secret|password|passwd|token|api[_-]?key|apikey|credential|private[_-]?key|authorization|cookie|connection[_-]?string|dsn)$/i;
const URL_WITH_CREDENTIALS = /^[a-z][a-z0-9+.-]*:\/\/[^/\s]*@/i;

/**
 * Deep-redacts a configuration value for display (§63). Keys that name a secret are always
 * `[REDACTED]`, whatever their value; `secrets` subtrees are redacted whole; URLs carrying
 * credentials and secret-shaped strings are masked too. `{ secret: NAME }` references stay,
 * since a reference names where a secret lives, not the secret itself.
 */
export function redactConfig(value: unknown, key = '', depth = 0): unknown {
  if (depth > 20) return '[TRUNCATED]';
  if (key === 'secrets') return '[REDACTED]';
  if (value === null || value === undefined || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (SECRET_KEY.test(key)) return '[REDACTED]';
    if (URL_WITH_CREDENTIALS.test(value)) return '[REDACTED]';
    return redactSecrets(value);
  }
  if (Array.isArray(value)) return value.map((entry) => redactConfig(entry, key, depth + 1));
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record);
    if (keys.length === 1 && keys[0] === 'secret' && typeof record['secret'] === 'string') return { secret: record['secret'] };
    if (SECRET_KEY.test(key)) return '[REDACTED]';
    return Object.fromEntries(keys.map((entry) => [entry, redactConfig(record[entry], entry, depth + 1)]));
  }
  return '[UNSERIALIZABLE]';
}
