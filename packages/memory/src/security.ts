import { CopilotError } from '@gixcopilot/protocol';
import type { SecurityContext } from '@gixcopilot/security';
import { memoryOwnersEqual, type MemoryOwner, type MemoryRecord } from './record.js';

/** Every memory operation must consider identity/tenant/owner/scope (Section 99). This is the
 * one place both store implementations call to decide access - defense in depth on top of
 * whatever pre-filtering the store's own query already did (mirrors the rag skill's "index-time
 * filter plus result-security-validation" rule, Section 63, applied to memory). */
export interface MemoryAccessRequest {
  readonly owner: MemoryOwner;
  readonly tenantId?: string;
}

function tenantMatches(record: Pick<MemoryRecord, 'tenantId'>, tenantId: string | undefined): boolean {
  if (record.tenantId === undefined) return tenantId === undefined;
  return record.tenantId === tenantId;
}

/** Never mix tenant A / tenant B or user C / user D memory in a shared unfiltered search
 * (Section 114). Fails closed: throws rather than returning a boolean, so a caller cannot
 * accidentally ignore the result the way it could ignore a `false`. */
export function assertMemoryAccess(
  record: MemoryRecord,
  requester: MemoryAccessRequest,
  operation: 'read' | 'write',
): void {
  const deny = (message: string, metadata?: Record<string, unknown>): CopilotError =>
    operation === 'read' ? CopilotError.memoryReadDenied(message, metadata) : CopilotError.memoryWriteDenied(message, metadata);
  if (!tenantMatches(record, requester.tenantId)) {
    throw deny(`Memory record "${record.id}" belongs to a different tenant.`, { memoryId: record.id });
  }
  if (!memoryOwnersEqual(record.owner, requester.owner)) {
    throw deny(`Memory record "${record.id}" belongs to a different owner.`, { memoryId: record.id });
  }
}

/**
 * Derives a `MemoryOwner` from a trusted `SecurityContext` (never from model/query input -
 * Section 145 applied to memory). The caller picks which owner scope is appropriate for a given
 * write (a user preference vs. a session-scoped fact vs. a tenant-wide note); this only maps a
 * scope choice onto the identity actually available in the trusted context.
 */
export function ownerFromSecurityContext(
  scope: MemoryOwner['type'],
  securityContext: SecurityContext,
): MemoryOwner {
  switch (scope) {
    case 'user': {
      if (!securityContext.identity) {
        throw CopilotError.authenticationRequired('A user-scoped memory requires an authenticated identity.');
      }
      return { type: 'user', id: securityContext.identity.subject };
    }
    case 'session': {
      if (!securityContext.session) {
        throw CopilotError.validation('A session-scoped memory requires a SecurityContext.session.');
      }
      return { type: 'session', id: securityContext.session.sessionId };
    }
    case 'tenant': {
      if (!securityContext.tenant) {
        throw CopilotError.tenantMismatch('A tenant-scoped memory requires a SecurityContext.tenant.');
      }
      return { type: 'tenant', id: securityContext.tenant.tenantId };
    }
    case 'workspace':
    case 'application': {
      const id = securityContext.metadata?.[`${scope}Id`];
      if (typeof id !== 'string' || id.length === 0) {
        throw CopilotError.validation(`A ${scope}-scoped memory requires SecurityContext.metadata.${scope}Id.`);
      }
      return { type: scope, id };
    }
  }
}
