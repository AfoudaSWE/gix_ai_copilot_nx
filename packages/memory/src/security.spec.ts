import { describe, expect, it } from 'vitest';
import type { SecurityContext } from '@gixcopilot/security';
import { CopilotError } from '@gixcopilot/protocol';
import { assertMemoryAccess, ownerFromSecurityContext } from './security.js';
import type { MemoryRecord } from './record.js';

function record(overrides: Partial<MemoryRecord> = {}): MemoryRecord {
  return {
    id: 'm1',
    type: 'durable',
    owner: { type: 'user', id: 'user-1' },
    tenantId: 'tenant-a',
    value: 'hello',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('assertMemoryAccess (TEST 164/165)', () => {
  it('allows the owning user in the right tenant', () => {
    expect(() =>
      assertMemoryAccess(record(), { owner: { type: 'user', id: 'user-1' }, tenantId: 'tenant-a' }, 'read'),
    ).not.toThrow();
  });

  it('denies a different user - memory ownership (TEST 164)', () => {
    expect(() =>
      assertMemoryAccess(record(), { owner: { type: 'user', id: 'user-2' }, tenantId: 'tenant-a' }, 'read'),
    ).toThrow(CopilotError);
  });

  it('denies a different tenant - memory tenant isolation (TEST 165)', () => {
    expect(() =>
      assertMemoryAccess(record(), { owner: { type: 'user', id: 'user-1' }, tenantId: 'tenant-b' }, 'read'),
    ).toThrow(CopilotError);
  });

  it('uses MEMORY_READ_DENIED for reads and MEMORY_WRITE_DENIED for writes', () => {
    expect(() =>
      assertMemoryAccess(record(), { owner: { type: 'user', id: 'user-2' }, tenantId: 'tenant-a' }, 'read'),
    ).toThrowError(expect.objectContaining({ code: 'MEMORY_READ_DENIED' }));
    expect(() =>
      assertMemoryAccess(record(), { owner: { type: 'user', id: 'user-2' }, tenantId: 'tenant-a' }, 'write'),
    ).toThrowError(expect.objectContaining({ code: 'MEMORY_WRITE_DENIED' }));
  });

  it('treats an ownerless (undefined tenantId) record as requiring an undefined requester tenant', () => {
    expect(() =>
      assertMemoryAccess(record({ tenantId: undefined }), { owner: { type: 'user', id: 'user-1' }, tenantId: undefined }, 'read'),
    ).not.toThrow();
    expect(() =>
      assertMemoryAccess(record({ tenantId: undefined }), { owner: { type: 'user', id: 'user-1' }, tenantId: 'tenant-a' }, 'read'),
    ).toThrow(CopilotError);
  });
});

describe('ownerFromSecurityContext (Section 95/145)', () => {
  const context: SecurityContext = {
    identity: { subject: 'user-1', roles: [], permissions: [] },
    tenant: { tenantId: 'tenant-a' },
    session: { sessionId: 'session-1' },
    metadata: { workspaceId: 'ws-1', applicationId: 'app-1' },
  };

  it('derives a user owner from identity.subject', () => {
    expect(ownerFromSecurityContext('user', context)).toEqual({ type: 'user', id: 'user-1' });
  });

  it('derives a session owner from session.sessionId', () => {
    expect(ownerFromSecurityContext('session', context)).toEqual({ type: 'session', id: 'session-1' });
  });

  it('derives a tenant owner from tenant.tenantId', () => {
    expect(ownerFromSecurityContext('tenant', context)).toEqual({ type: 'tenant', id: 'tenant-a' });
  });

  it('derives workspace/application owners from metadata', () => {
    expect(ownerFromSecurityContext('workspace', context)).toEqual({ type: 'workspace', id: 'ws-1' });
    expect(ownerFromSecurityContext('application', context)).toEqual({ type: 'application', id: 'app-1' });
  });

  it('refuses a user-scoped memory without an authenticated identity - never fabricate ownership (Section 145)', () => {
    expect(() => ownerFromSecurityContext('user', {})).toThrow(CopilotError);
  });

  it('refuses a tenant-scoped memory without a trusted tenant', () => {
    expect(() => ownerFromSecurityContext('tenant', {})).toThrow(CopilotError);
  });
});
