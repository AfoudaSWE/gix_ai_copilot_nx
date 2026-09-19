import type { ToolApprovalLevel } from '@gixcopilot/protocol';
import type { Identity } from './identity.js';

/** Section 16-18 - role -> permission resolution. Applications whose identity provider
 * already hands back a flat permission list can omit this entirely (`identity.permissions`
 * alone is respected); this is additive, not required. */
export type RolePermissionMap = Readonly<Record<string, readonly string[]>>;

/** Stable, namespaced permission identifiers are the authorization unit (Section 17) - never
 * a human-readable role label. This SDK does not prescribe a fixed permission catalog; an
 * application defines its own (e.g. `applications.view`) and references them from both
 * `RolePermissionMap` and a tool's `security.requiredPermissions`. */
export function resolvePermissions(
  identity: Identity,
  roleMap?: RolePermissionMap,
): readonly string[] {
  const fromRoles = roleMap
    ? identity.roles.flatMap((role) => roleMap[role] ?? [])
    : [];
  return Array.from(new Set([...identity.permissions, ...fromRoles]));
}

export function hasPermission(
  identity: Identity | undefined,
  permission: string,
  roleMap?: RolePermissionMap,
): boolean {
  if (!identity) return false;
  return resolvePermissions(identity, roleMap).includes(permission);
}

/** Every required permission must be held - a partial match is not sufficient (Section 20-21). */
export function hasAllPermissions(
  identity: Identity | undefined,
  required: readonly string[],
  roleMap?: RolePermissionMap,
): boolean {
  if (required.length === 0) return true;
  if (!identity) return false;
  const held = new Set(resolvePermissions(identity, roleMap));
  return required.every((permission) => held.has(permission));
}

/**
 * `approvals.<level>` convention (Section 33-34: "approval itself must be authorized").
 * `admin` also satisfies any lower level - an admin approver can stand in for a supervisor.
 * `user-confirmation` is the one level the original requester is expected to resolve
 * themselves (Section 32's own flow), so it is not gated by a permission the way
 * supervisor/admin/two-person are (Section 33's "do not assume the original user can self-
 * approve unless policy explicitly allows it" - `user-confirmation` is exactly the level
 * where that is explicitly allowed, by definition).
 */
export function canApprove(
  identity: Identity | undefined,
  level: ToolApprovalLevel,
  roleMap?: RolePermissionMap,
): boolean {
  if (!identity) return false;
  if (level === 'none' || level === 'user-confirmation') return true;
  if (hasPermission(identity, 'approvals.admin', roleMap)) return true;
  return hasPermission(identity, `approvals.${level}`, roleMap);
}

export function missingPermissions(
  identity: Identity | undefined,
  required: readonly string[],
  roleMap?: RolePermissionMap,
): readonly string[] {
  const held = new Set(identity ? resolvePermissions(identity, roleMap) : []);
  return required.filter((permission) => !held.has(permission));
}
