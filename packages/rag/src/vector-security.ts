import type { KnowledgeACL } from '@gixcopilot/knowledge';
import { CopilotError } from '@gixcopilot/protocol';
import type { VectorAccess } from './vectorstore.js';

/** Reject malformed and unknown ACL fields rather than treating them as public. */
export function isValidKnowledgeAcl(value: unknown): value is KnowledgeACL | undefined {
  if (value === undefined) return true;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.entries(value).every(([key, entries]) =>
    ['users', 'roles', 'permissions', 'groups'].includes(key) &&
    (entries === undefined || (Array.isArray(entries) && entries.every((entry: unknown) => typeof entry === 'string' && entry.length > 0))),
  );
}

/** ACL entries are alternative grants; an empty valid ACL is public within its tenant. */
export function matchesKnowledgeAcl(acl: KnowledgeACL | undefined, access: VectorAccess): boolean {
  if (!isValidKnowledgeAcl(acl)) return false;
  if (!acl || [acl.users, acl.roles, acl.permissions, acl.groups].every((entries) => !entries?.length)) return true;
  return Boolean(
    (access.subject !== undefined && acl.users?.includes(access.subject)) ||
    acl.roles?.some((role) => access.roles?.includes(role)) ||
    acl.permissions?.some((permission) => access.permissions?.includes(permission)) ||
    acl.groups?.some((group) => access.groups?.includes(group)),
  );
}

export function validateVector(embedding: readonly number[], dimensions?: number): void {
  if (!embedding.length || (dimensions !== undefined && embedding.length !== dimensions) || !embedding.every(Number.isFinite)) {
    throw CopilotError.vectorStoreFailed('Invalid embedding dimensions or non-finite vector values.');
  }
}

export function validateLimit(limit: number): void {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10_000) {
    throw CopilotError.validation('Result limit must be an integer between 1 and 10000.');
  }
}
