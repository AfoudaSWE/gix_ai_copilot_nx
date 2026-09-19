import type { Identity } from './identity.js';

/**
 * The integration boundary for an application's real authentication system (Section 14).
 * `requestContext` is deliberately `unknown` - this package must not assume Fastify,
 * Express, or any other transport; a server adapter (e.g. `@gixcopilot/server`) is
 * responsible for extracting whatever shape (headers, cookies, a session object) its own
 * transport provides and handing it to `authenticate()`. Returning `null` means "no
 * authenticated identity" - never throw for "not logged in", since that is an expected,
 * common outcome the caller must handle explicitly (fail-closed at the policy layer, not via
 * exception control flow here).
 */
export interface AuthenticationAdapter {
  authenticate(requestContext: unknown): Promise<Identity | null>;
}

/**
 * A deterministic, credential-free adapter for tests/demos (Section 14: "provide adapter
 * architecture plus at least one deterministic/testing implementation"). Resolves a bearer
 * token against a fixed, in-memory identity table - never a real authentication mechanism,
 * and never used to accept a role/identity supplied by the browser or model as authoritative
 * on its own (the token itself is still opaque; only a token this adapter was configured
 * with resolves to an identity).
 */
export function createStaticAuthenticationAdapter(
  identitiesByToken: Readonly<Record<string, Identity>>,
): AuthenticationAdapter {
  return {
    authenticate(requestContext: unknown): Promise<Identity | null> {
      const token = extractBearerToken(requestContext);
      if (!token) return Promise.resolve(null);
      const identity = identitiesByToken[token];
      return Promise.resolve(identity ?? null);
    },
  };
}

/** Reads `Authorization: Bearer <token>` from a plain headers-bag-shaped request context, or
 * a bare `{ token: string }` shape - the two conventions this SDK's own examples/tests use. */
function extractBearerToken(requestContext: unknown): string | undefined {
  if (typeof requestContext !== 'object' || requestContext === null) return undefined;
  const record = requestContext as Record<string, unknown>;
  if (typeof record['token'] === 'string') return record['token'];
  const headers = record['headers'];
  if (typeof headers !== 'object' || headers === null) return undefined;
  const authorization = (headers as Record<string, unknown>)['authorization'];
  if (typeof authorization !== 'string') return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(authorization);
  return match?.[1];
}
