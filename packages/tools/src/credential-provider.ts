import type { ToolExecutionContext } from './tool-definition.js';

/** Shared by `@gixcopilot/openapi` and `@gixcopilot/mcp` (Phase 8) - both external tool
 * sources need the same "resolve a credential server-side, never from model input, never
 * logged" guarantee, so this lives once, here, rather than being reimplemented per source
 * package (mirrors this file's `jsonSchemaToZod`/`toToolNameSegment` precedent).
 *
 * Passed to a `CredentialProvider` at execution time - carries the already-authenticated tool
 * execution context (never raw model input) so a future per-user credential adapter can
 * resolve a user-scoped token from identity Phase 7 middleware attaches to
 * `executionContext.metadata` ("Authenticated User -> Credential Adapter -> User-scoped API
 * token"), without either source package needing to implement a full OAuth platform now. */
export interface IntegrationContext {
  readonly integrationId: string;
  readonly executionContext: ToolExecutionContext;
}

/** The resolved credential for one call - a closed set of shapes rather than a free-form
 * header bag by default, so a credential provider's *intent* (bearer vs. API key vs. basic)
 * stays visible; `custom` remains available for anything else. */
export type IntegrationCredentials =
  | { readonly kind: 'bearer'; readonly token: string }
  | { readonly kind: 'apiKey'; readonly headerName: string; readonly value: string }
  | { readonly kind: 'basic'; readonly username: string; readonly password: string }
  | { readonly kind: 'custom'; readonly headers: Readonly<Record<string, string>> }
  | { readonly kind: 'none' };

/**
 * Resolves credentials for an integration's calls. Implementations run server-side only -
 * this interface is never imported by browser/React code, and a generated tool's
 * `inputSchema` never gains a credential-shaped field the model could fill in (the SDK must
 * never require the model to provide credentials).
 */
export interface CredentialProvider {
  getCredentials(context: IntegrationContext): Promise<IntegrationCredentials>;
}

/** A fixed token/API key resolved once at registration time - the common case for a single
 * server-to-server integration credential (e.g. from `process.env`, read once, never from
 * model input). */
export function staticCredentialProvider(credentials: IntegrationCredentials): CredentialProvider {
  return { getCredentials: () => Promise.resolve(credentials) };
}

/** No authentication (Section 36's "potential" list implies auth is optional, not mandatory -
 * a public/test API has none). Distinct from omitting a provider so the absence is explicit. */
export function noCredentialsProvider(): CredentialProvider {
  return staticCredentialProvider({ kind: 'none' });
}

/** Converts a resolved credential into the HTTP headers an HTTP-based executor/transport
 * merges into the outgoing request - the only place `IntegrationCredentials` ever becomes a
 * plain header bag, so there is exactly one place that must get this right. */
export function credentialsToHeaders(credentials: IntegrationCredentials): Readonly<Record<string, string>> {
  switch (credentials.kind) {
    case 'bearer':
      return { Authorization: `Bearer ${credentials.token}` };
    case 'apiKey':
      return { [credentials.headerName]: credentials.value };
    case 'basic':
      return { Authorization: `Basic ${Buffer.from(`${credentials.username}:${credentials.password}`).toString('base64')}` };
    case 'custom':
      return credentials.headers;
    case 'none':
      return {};
  }
}

/** Header names that must never appear in logs, traces, errors, or audit metadata - matched
 * case-insensitively since HTTP header names are case-insensitive. */
const SENSITIVE_HEADER_NAMES = new Set(
  ['authorization', 'proxy-authorization', 'cookie', 'set-cookie', 'x-api-key'].map((name) => name.toLowerCase()),
);

/**
 * Redacts credential-bearing headers before they reach a log line, error message, or audit
 * record. Any header name from `extraSensitiveNames` (e.g. a `custom` credential's own header
 * name, which this module cannot know in advance) is redacted too, case-insensitively,
 * alongside the fixed well-known set.
 */
export function redactSensitiveHeaders(
  headers: Readonly<Record<string, string>>,
  extraSensitiveNames: readonly string[] = [],
): Readonly<Record<string, string>> {
  const extra = new Set(extraSensitiveNames.map((name) => name.toLowerCase()));
  const redacted: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    const lower = name.toLowerCase();
    redacted[name] = SENSITIVE_HEADER_NAMES.has(lower) || extra.has(lower) ? '[REDACTED]' : value;
  }
  return redacted;
}

/** Removes known credential values even when an upstream server echoes them in a result. */
export function redactCredentialValues(value: unknown, headers: Readonly<Record<string, string>>): unknown {
  const secrets = Object.values(headers).flatMap((value) => [value, value.replace(/^(Bearer|Basic) /i, '')]).filter(Boolean).sort((a, b) => b.length - a.length);
  function visit(item: unknown): unknown {
    if (typeof item === 'string') return secrets.reduce((text, secret) => text.split(secret).join('[REDACTED]'), item);
    if (Array.isArray(item)) return item.map(visit);
    if (item && typeof item === 'object') return Object.fromEntries(Object.entries(item).map(([key, child]) => [String(visit(key)), visit(child)]));
    return item;
  }
  return visit(value);
}
