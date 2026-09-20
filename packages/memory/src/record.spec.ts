import { describe, expect, it } from 'vitest';
import { isMemoryExpired, memoryOwnerKey, memoryOwnersEqual, type MemoryRecord } from './record.js';

function record(overrides: Partial<MemoryRecord> = {}): MemoryRecord {
  return {
    id: 'm1',
    type: 'durable',
    owner: { type: 'user', id: 'user-1' },
    value: 'hello',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('isMemoryExpired', () => {
  it('is false when there is no expiresAt', () => {
    expect(isMemoryExpired(record())).toBe(false);
  });

  it('is false before the expiry time', () => {
    const now = new Date('2026-01-01T00:00:00.000Z');
    expect(isMemoryExpired(record({ expiresAt: '2026-01-02T00:00:00.000Z' }), now)).toBe(false);
  });

  it('is true at/after the expiry time (Section 103/166)', () => {
    const now = new Date('2026-01-02T00:00:00.000Z');
    expect(isMemoryExpired(record({ expiresAt: '2026-01-02T00:00:00.000Z' }), now)).toBe(true);
    expect(isMemoryExpired(record({ expiresAt: '2026-01-01T00:00:00.000Z' }), now)).toBe(true);
  });
});

describe('memoryOwnersEqual', () => {
  it('is true only when type and id both match', () => {
    expect(memoryOwnersEqual({ type: 'user', id: 'a' }, { type: 'user', id: 'a' })).toBe(true);
    expect(memoryOwnersEqual({ type: 'user', id: 'a' }, { type: 'user', id: 'b' })).toBe(false);
    expect(memoryOwnersEqual({ type: 'user', id: 'a' }, { type: 'session', id: 'a' })).toBe(false);
  });
});

describe('memoryOwnerKey', () => {
  it('produces a stable, distinct key per owner', () => {
    expect(memoryOwnerKey({ type: 'user', id: 'a' })).toBe('user:a');
    expect(memoryOwnerKey({ type: 'user', id: 'a' })).not.toBe(memoryOwnerKey({ type: 'session', id: 'a' }));
  });
});
