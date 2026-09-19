/**
 * Canonical, auth-provider-neutral identity (Section 12). Potential sources - JWT, OAuth,
 * OIDC, an enterprise SSO, a custom session, an API gateway - all normalize into this one
 * shape via an `AuthenticationAdapter` (see authentication.ts); nothing downstream (policy,
 * the firewall, approval) ever branches on which auth system produced it.
 */
export interface Identity {
  readonly subject: string;
  readonly roles: readonly string[];
  readonly permissions: readonly string[];
  readonly attributes?: Readonly<Record<string, unknown>>;
}

/** Section 15 - never accept a tenant id from model-generated tool arguments as authoritative. */
export interface TenantIdentity {
  readonly tenantId: string;
}

export interface SessionIdentity {
  readonly sessionId: string;
  readonly issuedAt?: string;
}

export interface SecurityEnvironment {
  readonly name?: string;
}

/**
 * The trusted authorization context for one action evaluation (Section 11). Built once at
 * the server/session boundary (see authentication.ts) and passed down explicitly - never
 * re-derived deep in tool/business logic, and never merged with model-provided values (see
 * the security skill's "authentication established once, propagated explicitly" rule).
 */
export interface SecurityContext {
  readonly identity?: Identity;
  readonly tenant?: TenantIdentity;
  readonly session?: SessionIdentity;
  readonly environment?: SecurityEnvironment;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/** An unauthenticated context - the safe, explicit default (never `undefined` implicitly). */
export const ANONYMOUS_SECURITY_CONTEXT: SecurityContext = {};
