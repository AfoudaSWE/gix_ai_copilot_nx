import { CopilotError } from '@gixcopilot/protocol';
import type { SecurityContext } from '@gixcopilot/security';

/** The authenticated tenant of a request. Never taken from model output or request bodies. */
export interface TenantContext {
  readonly tenantId: string;
}

/**
 * Where a run executes: tenant, and optionally project and environment. Every persistent,
 * tenant-owned record is written and read under a scope.
 */
export interface RuntimeScope extends TenantContext {
  readonly projectId?: string;
  readonly environment?: string;
}

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

function attribute(context: SecurityContext, key: string): string | undefined {
  const value = context.identity?.attributes?.[key];
  return typeof value === 'string' && ID.test(value) ? value : undefined;
}

/**
 * Derives the runtime scope from the authenticated `SecurityContext` (tenant from the
 * authentication adapter; project/environment from trusted identity attributes). Returns
 * `undefined` when the caller has no tenant.
 */
export function scopeFromSecurityContext(context: SecurityContext): RuntimeScope | undefined {
  const tenantId = context.tenant?.tenantId;
  if (!tenantId || !ID.test(tenantId)) return undefined;
  const projectId = attribute(context, 'projectId');
  const environment = attribute(context, 'environment');
  return { tenantId, ...(projectId ? { projectId } : {}), ...(environment ? { environment } : {}) };
}

/** Like `scopeFromSecurityContext`, but a missing tenant is an authentication error. */
export function requireScope(context: SecurityContext): RuntimeScope {
  const scope = scopeFromSecurityContext(context);
  if (!scope) throw CopilotError.authentication('An authenticated tenant is required for this operation.');
  return scope;
}

/** Throws when a record owned by `ownerTenantId` is accessed from another tenant. */
export function assertTenantOwns(scope: TenantContext, ownerTenantId: string | undefined, resource: string): void {
  if (ownerTenantId !== scope.tenantId) {
    throw CopilotError.tenantMismatch(`${resource} belongs to a different tenant.`);
  }
}

/** Validates a caller-supplied identifier (ids are never interpolated into queries unchecked). */
export function assertValidId(value: string, what: string): string {
  if (!ID.test(value)) throw CopilotError.validation(`Invalid ${what}.`);
  return value;
}
