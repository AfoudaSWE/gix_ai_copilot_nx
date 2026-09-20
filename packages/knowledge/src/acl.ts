/**
 * Access-control metadata attached to a knowledge source/document at ingestion time (Section
 * 60). This is *descriptive* metadata only - it participates in deterministic authorization
 * inside @gixcopilot/rag's retriever (query-time, against a trusted SecurityContext), never
 * enforced here. A knowledge/document with no ACL is effectively unrestricted within its
 * tenant - callers that want to restrict a source must say so explicitly.
 */
export interface KnowledgeACL {
  readonly users?: readonly string[];
  readonly roles?: readonly string[];
  readonly permissions?: readonly string[];
  readonly groups?: readonly string[];
}

function isNonEmpty(values: readonly string[] | undefined): values is readonly string[] {
  return values !== undefined && values.length > 0;
}

/** An ACL with no populated field grants no additional restriction beyond tenant scoping. */
export function isUnrestrictedAcl(acl: KnowledgeACL | undefined): boolean {
  if (!acl) return true;
  return !isNonEmpty(acl.users) && !isNonEmpty(acl.roles) && !isNonEmpty(acl.permissions) && !isNonEmpty(acl.groups);
}
