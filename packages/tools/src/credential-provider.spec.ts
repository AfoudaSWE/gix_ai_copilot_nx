import { describe, expect, it } from 'vitest';
import {
  credentialsToHeaders,
  noCredentialsProvider,
  redactSensitiveHeaders,
  staticCredentialProvider,
} from './credential-provider.js';
import type { IntegrationContext } from './credential-provider.js';

const context: IntegrationContext = {
  integrationId: 'vas',
  executionContext: { runId: 'run-1', signal: new AbortController().signal },
};

describe('credentialsToHeaders', () => {
  it('converts a bearer credential into an Authorization header', () => {
    expect(credentialsToHeaders({ kind: 'bearer', token: 'abc123' })).toEqual({ Authorization: 'Bearer abc123' });
  });

  it('converts an apiKey credential into its named header', () => {
    expect(credentialsToHeaders({ kind: 'apiKey', headerName: 'X-Api-Key', value: 'k-1' })).toEqual({ 'X-Api-Key': 'k-1' });
  });

  it('converts a basic credential into a base64-encoded Authorization header', () => {
    const headers = credentialsToHeaders({ kind: 'basic', username: 'user', password: 'pass' });
    expect(headers['Authorization']).toBe(`Basic ${Buffer.from('user:pass').toString('base64')}`);
  });

  it('passes through a custom credential unchanged', () => {
    expect(credentialsToHeaders({ kind: 'custom', headers: { 'X-Custom': 'v' } })).toEqual({ 'X-Custom': 'v' });
  });

  it('produces no headers for "none"', () => {
    expect(credentialsToHeaders({ kind: 'none' })).toEqual({});
  });
});

describe('staticCredentialProvider / noCredentialsProvider', () => {
  it('resolves to the fixed credential every call', async () => {
    const provider = staticCredentialProvider({ kind: 'bearer', token: 't' });
    expect(await provider.getCredentials(context)).toEqual({ kind: 'bearer', token: 't' });
    expect(await provider.getCredentials(context)).toEqual({ kind: 'bearer', token: 't' });
  });

  it('noCredentialsProvider resolves to kind: none', async () => {
    expect(await noCredentialsProvider().getCredentials(context)).toEqual({ kind: 'none' });
  });
});

describe('redactSensitiveHeaders', () => {
  it('redacts well-known sensitive headers case-insensitively', () => {
    const redacted = redactSensitiveHeaders({
      Authorization: 'Bearer secret',
      'X-Api-Key': 'key-1',
      Cookie: 'session=abc',
      'Content-Type': 'application/json',
    });
    expect(redacted['Authorization']).toBe('[REDACTED]');
    expect(redacted['X-Api-Key']).toBe('[REDACTED]');
    expect(redacted['Cookie']).toBe('[REDACTED]');
    expect(redacted['Content-Type']).toBe('application/json');
  });

  it('redacts extra sensitive names for custom credential headers', () => {
    const redacted = redactSensitiveHeaders({ 'X-Custom-Secret': 'v', 'X-Trace-Id': 't' }, ['X-Custom-Secret']);
    expect(redacted['X-Custom-Secret']).toBe('[REDACTED]');
    expect(redacted['X-Trace-Id']).toBe('t');
  });

  it('never mutates the input headers object', () => {
    const headers = { Authorization: 'Bearer secret' };
    redactSensitiveHeaders(headers);
    expect(headers['Authorization']).toBe('Bearer secret');
  });
});
