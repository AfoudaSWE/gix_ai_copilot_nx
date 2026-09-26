import { describe, expect, it } from 'vitest';
import { REDACTED, createRedactionPolicy, maskSecretsInText } from './redaction.js';

/**
 * Mandatory (Phase 11 Section 175): a password, a token, an API key, PII, and a sensitive
 * tool argument injected into a payload must never survive into diagnostics under any
 * safe mode. `development-verbose` may keep PII and payloads but must STILL mask secrets
 * (Section 59).
 */
const SENSITIVE_PAYLOAD = {
  user: { email: 'jordan.miles@example.com', phone: '+1 (555) 123-4567', firstName: 'Jordan', ssn: '123-45-6789' },
  password: 'hunter2',
  apiKey: 'sk-abcdefghijklmnopqrstuvwxyz123456',
  headers: { Authorization: 'Bearer abcdefghijklmnopqrstuvwxyz' },
  nested: { refresh_token: 'rt-secret-value', note: 'contact me at jordan.miles@example.com' },
  card: { cardNumber: '4111 1111 1111 1111' },
  toolArguments: { applicationId: 'APP-1024', accessToken: 'tok_123456789012345' },
  jwt: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c',
};

const LEAK_MARKERS = [
  'hunter2',
  'sk-abcdefghijklmnopqrstuvwxyz123456',
  'abcdefghijklmnopqrstuvwxyz',
  'rt-secret-value',
  'tok_123456789012345',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9',
];

const PII_MARKERS = ['jordan.miles@example.com', '555', '123-45-6789', '4111', 'Jordan'];

describe('createRedactionPolicy', () => {
  it("'redacted' (the default) strips every secret and every PII marker from a structured payload", () => {
    const policy = createRedactionPolicy();
    expect(policy.mode).toBe('redacted');
    const serialized = JSON.stringify(policy.payload(SENSITIVE_PAYLOAD));
    for (const marker of [...LEAK_MARKERS, ...PII_MARKERS]) {
      expect(serialized, `leaked "${marker}"`).not.toContain(marker);
    }
    // Non-sensitive structure survives so the payload stays useful.
    expect(serialized).toContain('APP-1024');
    expect(serialized).toContain(REDACTED);
  });

  it("'metadata-only' records no payload at all", () => {
    const policy = createRedactionPolicy({ mode: 'metadata-only' });
    expect(policy.payload(SENSITIVE_PAYLOAD)).toBeUndefined();
    expect(policy.text('hunter2 sk-abcdefghijklmnopqrstuvwxyz123456')).toBeUndefined();
    expect(policy.capturesPayloads).toBe(false);
  });

  it("'off' records nothing", () => {
    const policy = createRedactionPolicy({ mode: 'off' });
    expect(policy.payload({ password: 'x' })).toBeUndefined();
    expect(policy.text('x')).toBeUndefined();
  });

  it("'development-verbose' keeps PII and payloads but still masks every secret", () => {
    const policy = createRedactionPolicy({ mode: 'development-verbose' });
    const serialized = JSON.stringify(policy.payload(SENSITIVE_PAYLOAD));
    for (const marker of LEAK_MARKERS) {
      expect(serialized, `leaked "${marker}"`).not.toContain(marker);
    }
    expect(serialized).toContain('jordan.miles@example.com');
    expect(serialized).toContain('Jordan');
  });

  it('masks secret-shaped values inside free text under every capturing mode', () => {
    const text = 'call with Authorization: Bearer abcdefghijklmnopqrstuvwxyz and key sk-abcdefghijklmnopqrstuvwxyz123456';
    for (const mode of ['redacted', 'development-verbose'] as const) {
      const out = createRedactionPolicy({ mode }).text(text) ?? '';
      expect(out).not.toContain('sk-abcdefghijklmnopqrstuvwxyz123456');
      expect(out).not.toContain('Bearer abcdefghijklmnopqrstuvwxyz');
    }
    expect(maskSecretsInText('AKIAIOSFODNN7EXAMPLE')).toBe(REDACTED);
  });

  it('masks PII patterns in free text under redacted mode only', () => {
    const text = 'email jordan.miles@example.com or 555-123-4567';
    expect(createRedactionPolicy({ mode: 'redacted' }).text(text)).not.toContain('jordan.miles@example.com');
    expect(createRedactionPolicy({ mode: 'development-verbose' }).text(text)).toContain('jordan.miles@example.com');
  });

  it('scrub() always masks secret keys regardless of mode, leaving everything else intact', () => {
    const policy = createRedactionPolicy({ mode: 'metadata-only' });
    expect(policy.scrub({ 'copilot.tool_name': 'applications.get', api_key: 'sk-abcdefghijklmnopqrstuvwxyz123456' })).toEqual({
      'copilot.tool_name': 'applications.get',
      api_key: REDACTED,
    });
  });

  it('truncates long strings and bounds depth', () => {
    const policy = createRedactionPolicy({ mode: 'redacted', maxStringLength: 10, maxDepth: 2 });
    const out = policy.payload({ text: 'a'.repeat(50), deep: { a: { b: { c: 1 } } } }) as { text: string; deep: { a: { b: unknown } } };
    expect(out.text.startsWith('aaaaaaaaaa')).toBe(true);
    expect(out.text).toContain('[truncated 40 chars]');
    expect(out.deep.a.b).toBe('[depth-limit]');
  });

  it('applies a host DataPolicy first and treats extra keys as secrets', () => {
    const policy = createRedactionPolicy({
      mode: 'development-verbose',
      dataPolicy: { redact: (data) => ({ ...(data as object), fromPolicy: 'applied' }) },
      extraSecretKeys: ['internalRef'],
    });
    expect(policy.payload({ internalRef: 'ref-1', ok: true })).toEqual({ internalRef: REDACTED, ok: true, fromPolicy: 'applied' });
  });

  it("does not treat a generic 'name' or 'author' key as sensitive", () => {
    const policy = createRedactionPolicy();
    expect(policy.payload({ name: 'applications.get', author: 'team' })).toEqual({ name: 'applications.get', author: 'team' });
  });

  it('keeps numeric token counts (span attributes) while still masking numeric card data', () => {
    const policy = createRedactionPolicy();
    const scrubbed = policy.scrub({ 'copilot.tokens.input': 12, 'copilot.tokens.total': 15, authorizedCount: 2, authenticated: true, cvv: 123, password: 1234, accessToken: 'tok_abcdef' }) as Record<string, unknown>;
    expect(scrubbed['authorizedCount']).toBe(2);
    expect(scrubbed['authenticated']).toBe(true);
    expect(scrubbed['password']).toBe(REDACTED);
    expect(scrubbed['copilot.tokens.input']).toBe(12);
    expect(scrubbed['copilot.tokens.total']).toBe(15);
    expect(scrubbed['cvv']).toBe(REDACTED);
    expect(scrubbed['accessToken']).toBe(REDACTED);
  });
});
