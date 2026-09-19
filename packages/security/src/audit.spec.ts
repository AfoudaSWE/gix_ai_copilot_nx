import { describe, expect, it, vi } from 'vitest';
import { createInMemoryAuditSink, createSafeAuditSink } from './audit.js';
import type { AuditRecord } from './audit.js';

function record(overrides: Partial<AuditRecord> = {}): AuditRecord {
  return {
    id: 'audit-1',
    timestamp: new Date().toISOString(),
    actor: { kind: 'user', subject: 'u1' },
    action: 'applications.reassign',
    decision: 'allow',
    ...overrides,
  };
}

describe('createInMemoryAuditSink', () => {
  it('accumulates written records in order', async () => {
    const sink = createInMemoryAuditSink();
    await sink.write(record({ id: '1' }));
    await sink.write(record({ id: '2' }));
    expect(sink.list().map((r) => r.id)).toEqual(['1', '2']);
  });
});

describe('createSafeAuditSink', () => {
  it('fail-open (default): swallows a write failure and does not reject', async () => {
    const onError = vi.fn();
    const failing = { write: () => Promise.reject(new Error('db down')) };
    const safe = createSafeAuditSink(failing, 'fail-open', onError);
    await expect(safe.write(record())).resolves.toBeUndefined();
    expect(onError).toHaveBeenCalledOnce();
  });

  it('fail-closed: rethrows so the caller can abort the action', async () => {
    const failing = { write: () => Promise.reject(new Error('db down')) };
    const safe = createSafeAuditSink(failing, 'fail-closed');
    await expect(safe.write(record())).rejects.toThrow('db down');
  });

  it('a successful write never triggers onError', async () => {
    const sink = createInMemoryAuditSink();
    const onError = vi.fn();
    const safe = createSafeAuditSink(sink, 'fail-open', onError);
    await safe.write(record());
    expect(onError).not.toHaveBeenCalled();
    expect(sink.list()).toHaveLength(1);
  });
});
