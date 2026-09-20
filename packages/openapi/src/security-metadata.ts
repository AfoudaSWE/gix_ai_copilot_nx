import type { ToolActionRisk, ToolSecurityManifest } from '@gixcopilot/protocol';
import type { ExposureDecision } from './exposure-policy.js';
import type { HttpMethod, OpenAPIOperationCandidate } from './types.js';

/** Safe automatic risk defaults (Section 47), keyed by HTTP method - applied only when the
 * operation's override does not declare `risk` explicitly. `HEAD`/`OPTIONS`/`TRACE` are treated
 * as read-only; they default to `deny` exposure (see `exposure-policy.ts`) so this rarely
 * matters, but an explicit opt-in still gets a sane risk value instead of an absent one. */
const BUILTIN_RISK_DEFAULTS: Record<HttpMethod, ToolActionRisk> = {
  get: 'read-only',
  head: 'read-only',
  options: 'read-only',
  trace: 'read-only',
  post: 'write',
  put: 'write',
  patch: 'write',
  delete: 'destructive',
};

export interface SecurityMetadataOptions {
  readonly integrationId: string;
  /** Default permission applied when the operation's override sets neither
   * `requiredPermissions` nor `permission` (Section 46). Every generated tool must require
   * *some* permission: leaving `requiredPermissions` unset entirely means "available to every
   * authenticated user" (see `@gixcopilot/security`'s tool-discovery module), which would
   * silently defeat Phase 7's permission gate for an entire external API's worth of tools.
   * Defaults to one coarse permission scoping the whole integration (`openapi.<integrationId>`);
   * pass a function to derive a per-operation permission instead. */
  readonly defaultPermission?: string | ((candidate: OpenAPIOperationCandidate) => string);
}

function defaultPermissionFor(candidate: OpenAPIOperationCandidate, options: SecurityMetadataOptions): string {
  if (typeof options.defaultPermission === 'function') return options.defaultPermission(candidate);
  return options.defaultPermission ?? `openapi.${options.integrationId}`;
}

/**
 * Maps an operation's exposure decision (`exposure-policy.ts`) and override into the same
 * `ToolSecurityManifest` shape every other tool in this SDK declares (Section 46), so
 * `@gixcopilot/security`'s Action Firewall enforces a generated OpenAPI tool identically to a
 * hand-written one - never a parallel or weaker enforcement path (Section 5).
 *
 * `risk` is derived from the HTTP method (Section 47's table) unless the override sets one
 * explicitly - never guessed from the operation's summary/description/path text (Section 46's
 * "do NOT guess dangerous semantics solely from endpoint names"). `approval` is left unset
 * unless the override provides one explicitly: an unset `approval` lets the application's own
 * configured risk policy (e.g. `@gixcopilot/security`'s `createDefaultRiskPolicy`) compute it
 * from `risk`/`reversibility` exactly as it does for every other tool - this function
 * deliberately does not duplicate that computation (Section 29's "avoid duplicating validation
 * logic" applies just as much to policy logic).
 */
export function buildSecurityMetadata(
  candidate: OpenAPIOperationCandidate,
  decision: ExposureDecision,
  options: SecurityMetadataOptions,
): ToolSecurityManifest {
  const override = decision.override;
  const requiredPermissions =
    override?.requiredPermissions ??
    (override?.permission !== undefined ? [override.permission] : [defaultPermissionFor(candidate, options)]);

  return {
    requiredPermissions,
    risk: override?.risk ?? BUILTIN_RISK_DEFAULTS[candidate.method],
    reversibility: override?.reversibility,
    approval: override?.approval ?? (decision.exposure === 'approval' && (override?.risk ?? BUILTIN_RISK_DEFAULTS[candidate.method]) === 'read-only' ? 'user-confirmation' : undefined),
    dataClassification: override?.dataClassification,
  };
}
