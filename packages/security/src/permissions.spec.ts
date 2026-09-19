import { describe, expect, it } from 'vitest';
import { canApprove, hasAllPermissions, hasPermission, missingPermissions, resolvePermissions } from './permissions.js';
import type { Identity } from './identity.js';

const viewer: Identity = { subject: 'u1', roles: ['APPLICATION_VIEWER'], permissions: [] };
const roleMap = {
  APPLICATION_VIEWER: ['applications.view'],
  APPLICATION_MANAGER: ['applications.view', 'applications.assign', 'applications.reassign'],
};

describe('resolvePermissions', () => {
  it('combines direct permissions with role-derived ones, de-duplicated', () => {
    const identity: Identity = { subject: 'u2', roles: ['APPLICATION_VIEWER'], permissions: ['applications.view'] };
    expect(resolvePermissions(identity, roleMap)).toEqual(['applications.view']);
  });

  it('returns only direct permissions when no role map is given', () => {
    expect(resolvePermissions(viewer)).toEqual([]);
  });
});

describe('hasPermission / hasAllPermissions', () => {
  it('grants a permission held via role', () => {
    expect(hasPermission(viewer, 'applications.view', roleMap)).toBe(true);
  });

  it('denies a permission not held', () => {
    expect(hasPermission(viewer, 'applications.delete', roleMap)).toBe(false);
  });

  it('denies for an undefined identity (Section 96-97 unauthorized defaults)', () => {
    expect(hasPermission(undefined, 'applications.view', roleMap)).toBe(false);
  });

  it('requires every listed permission, not just one', () => {
    expect(hasAllPermissions(viewer, ['applications.view', 'applications.delete'], roleMap)).toBe(false);
    expect(hasAllPermissions(viewer, ['applications.view'], roleMap)).toBe(true);
  });

  it('an empty requirement list is always satisfied', () => {
    expect(hasAllPermissions(undefined, [])).toBe(true);
  });
});

describe('canApprove (Section 27, 33-34 - approve/reject must itself be authorized)', () => {
  const supervisor: Identity = { subject: 's1', roles: [], permissions: ['approvals.supervisor'] };
  const admin: Identity = { subject: 'a1', roles: [], permissions: ['approvals.admin'] };

  it('any authenticated identity can resolve user-confirmation (the requester confirming their own action)', () => {
    expect(canApprove(viewer, 'user-confirmation')).toBe(true);
  });

  it('an unprivileged user cannot resolve a supervisor approval (Section 96-97 spirit, applied to approvals)', () => {
    expect(canApprove(viewer, 'supervisor')).toBe(false);
  });

  it('a supervisor can resolve a supervisor approval', () => {
    expect(canApprove(supervisor, 'supervisor')).toBe(true);
  });

  it('a supervisor cannot resolve an admin approval', () => {
    expect(canApprove(supervisor, 'admin')).toBe(false);
  });

  it('an admin can resolve any lower level too', () => {
    expect(canApprove(admin, 'supervisor')).toBe(true);
    expect(canApprove(admin, 'two-person')).toBe(true);
  });
});

describe('missingPermissions', () => {
  it('lists exactly the permissions not held', () => {
    expect(missingPermissions(viewer, ['applications.view', 'applications.delete'], roleMap)).toEqual([
      'applications.delete',
    ]);
  });
});
