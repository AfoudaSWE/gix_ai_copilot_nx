import { createHmac, timingSafeEqual } from 'node:crypto';
import type { AuthenticationAdapter, Identity } from '@gixcopilot/security';

/**
 * Reference authentication for the API server: HS256 JWTs verified with `node:crypto` (no
 * extra dependency). Tenant, project and environment come ONLY from the verified token
 * (`tenant_id`, `project_id`, `environment` claims), never from request bodies or model output.
 *
 * For production SSO, terminate OIDC at a gateway that mints these tokens, or replace this with
 * your own `AuthenticationAdapter` (e.g. RS256/JWKS verification).
 */
export interface JwtOptions {
  readonly secret: string;
  readonly issuer?: string;
  readonly audience?: string;
  readonly clockToleranceSeconds?: number;
  readonly now?: () => number;
}

interface Claims {
  readonly sub?: unknown;
  readonly exp?: unknown;
  readonly nbf?: unknown;
  readonly iss?: unknown;
  readonly aud?: unknown;
  readonly tenant_id?: unknown;
  readonly project_id?: unknown;
  readonly environment?: unknown;
  readonly roles?: unknown;
  readonly permissions?: unknown;
}

const decode = (segment: string): unknown => JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []);

export function verifyJwt(token: string, options: JwtOptions): Identity | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [headerPart, payloadPart, signaturePart] = parts as [string, string, string];
  let header: { alg?: unknown; typ?: unknown };
  let claims: Claims;
  try {
    header = decode(headerPart) as typeof header;
    claims = decode(payloadPart) as Claims;
  } catch {
    return null;
  }
  // Only HS256: rejects `alg: none` and algorithm-confusion tokens.
  if (header.alg !== 'HS256') return null;
  const expected = createHmac('sha256', options.secret).update(`${headerPart}.${payloadPart}`).digest();
  const provided = Buffer.from(signaturePart, 'base64url');
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return null;
  const now = Math.floor((options.now?.() ?? Date.now()) / 1000);
  const tolerance = options.clockToleranceSeconds ?? 30;
  if (typeof claims.exp !== 'number' || claims.exp + tolerance < now) return null;
  if (typeof claims.nbf === 'number' && claims.nbf - tolerance > now) return null;
  if (options.issuer && claims.iss !== options.issuer) return null;
  if (options.audience) {
    const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!audiences.includes(options.audience)) return null;
  }
  if (typeof claims.sub !== 'string' || claims.sub.length === 0) return null;
  const attributes: Record<string, string> = {};
  if (typeof claims.tenant_id === 'string') attributes['tenantId'] = claims.tenant_id;
  if (typeof claims.project_id === 'string') attributes['projectId'] = claims.project_id;
  if (typeof claims.environment === 'string') attributes['environment'] = claims.environment;
  return { subject: claims.sub, roles: strings(claims.roles), permissions: strings(claims.permissions), attributes };
}

/** Signs a token (tests, local development and the example's token helper only). */
export function signJwt(claims: Record<string, unknown>, secret: string): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const signature = createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${signature}`;
}

export function createJwtAuthenticationAdapter(options: JwtOptions): AuthenticationAdapter {
  return {
    authenticate(requestContext: unknown) {
      const headers = (requestContext as { headers?: Record<string, string | string[] | undefined> } | undefined)?.headers;
      const header = headers?.['authorization'];
      const value = Array.isArray(header) ? header[0] : header;
      const token = value?.startsWith('Bearer ') ? value.slice(7).trim() : undefined;
      return Promise.resolve(token ? verifyJwt(token, options) : null);
    },
  };
}
