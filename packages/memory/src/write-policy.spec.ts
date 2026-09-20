import { describe, expect, it } from 'vitest';
import { containsSensitiveContent, createDefaultMemoryWritePolicy, createPermissiveMemoryWritePolicy } from './write-policy.js';
import type { MemoryPutInput } from './store.js';

function input(value: unknown): MemoryPutInput {
  return { type: 'durable', owner: { type: 'user', id: 'u1' }, value };
}

describe('containsSensitiveContent', () => {
  it('flags an OpenAI-shaped API key', () => {
    expect(containsSensitiveContent('my key is sk-abcdefghijklmnopqrstuvwx')).toBe(true);
  });

  it('flags a bearer token', () => {
    expect(containsSensitiveContent('Authorization: Bearer abcdefghij1234567890')).toBe(true);
  });

  it('flags a password/secret key-value pair', () => {
    expect(containsSensitiveContent('password: hunter22222')).toBe(true);
    expect(containsSensitiveContent('api_key=xyz1234567890')).toBe(true);
  });

  it('flags a PEM private key block', () => {
    expect(containsSensitiveContent('-----BEGIN RSA PRIVATE KEY-----\nMIIB...')).toBe(true);
  });

  it('does not flag ordinary content', () => {
    expect(containsSensitiveContent('The user prefers concise technical answers.')).toBe(false);
  });

  it('checks structured values by serializing them', () => {
    expect(containsSensitiveContent({ note: 'access_token=abc1234567890' })).toBe(true);
    expect(containsSensitiveContent({ note: 'prefers dark mode' })).toBe(false);
  });
});

describe('createDefaultMemoryWritePolicy (Section 100-102, TEST 168)', () => {
  it('rejects a write whose value looks like a credential', async () => {
    const policy = createDefaultMemoryWritePolicy();
    const decision = await policy.evaluate(input('sk-abcdefghijklmnopqrstuvwx'));
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBeDefined();
  });

  it('allows ordinary content', async () => {
    const policy = createDefaultMemoryWritePolicy();
    const decision = await policy.evaluate(input('User prefers concise technical answers.'));
    expect(decision.allowed).toBe(true);
  });
});

describe('createPermissiveMemoryWritePolicy', () => {
  it('always allows, for tests/examples that intentionally opt out', async () => {
    const policy = createPermissiveMemoryWritePolicy();
    const decision = await policy.evaluate(input('sk-abcdefghijklmnopqrstuvwx'));
    expect(decision.allowed).toBe(true);
  });
});
