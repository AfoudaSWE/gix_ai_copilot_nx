import { describe, expect, it } from 'vitest';
import { createJwtAuthenticationAdapter, signJwt, verifyJwt } from './auth.js';

const secret = 'test-only-jwt-secret-0123456789abcdef';
const now = Date.parse('2026-09-27T12:00:00Z');
const base = { sub: 'alice', tenant_id: 'acme', project_id: 'visa', environment: 'production', roles: ['officer'], permissions: ['applications.read'], exp: now / 1000 + 600, iss: 'aicopilot', aud: 'api' };
const options = { secret, issuer: 'aicopilot', audience: 'api', now: () => now };

describe('reference JWT authentication', () => {
  it('derives identity and tenant only from a verified token', async () => {
    expect(verifyJwt(signJwt(base, secret), options)).toEqual({
      subject: 'alice',
      roles: ['officer'],
      permissions: ['applications.read'],
      attributes: { tenantId: 'acme', projectId: 'visa', environment: 'production' },
    });
    const adapter = createJwtAuthenticationAdapter(options);
    expect(await adapter.authenticate({ headers: { authorization: `Bearer ${signJwt(base, secret)}` } })).toMatchObject({ subject: 'alice' });
    expect(await adapter.authenticate({ headers: {} })).toBeNull();
  });

  it('rejects forged, expired, wrong-audience and alg-none tokens', () => {
    expect(verifyJwt(signJwt(base, 'another-secret'), options)).toBeNull();
    expect(verifyJwt(signJwt({ ...base, exp: now / 1000 - 3600 }, secret), options)).toBeNull();
    expect(verifyJwt(signJwt({ ...base, nbf: now / 1000 + 3600 }, secret), options)).toBeNull();
    expect(verifyJwt(signJwt({ ...base, aud: 'other' }, secret), options)).toBeNull();
    expect(verifyJwt(signJwt({ ...base, iss: 'evil' }, secret), options)).toBeNull();
    expect(verifyJwt(signJwt({ ...base, exp: undefined }, secret), options)).toBeNull();
    const [, payload] = signJwt(base, secret).split('.');
    const none = `${Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url')}.${payload}.`;
    expect(verifyJwt(none, options)).toBeNull();
    // Tampering with the tenant claim breaks the signature.
    const [header, , signature] = signJwt(base, secret).split('.');
    const forged = `${header}.${Buffer.from(JSON.stringify({ ...base, tenant_id: 'globex' })).toString('base64url')}.${signature}`;
    expect(verifyJwt(forged, options)).toBeNull();
    expect(verifyJwt('garbage', options)).toBeNull();
  });
});
