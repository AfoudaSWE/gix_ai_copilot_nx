import { describe, expect, it } from 'vitest';
import { createDeterministicEmbeddingProvider } from '@gixcopilot/rag';
import { CopilotError } from '@gixcopilot/protocol';
import { createInMemoryMemoryStore } from './in-memory-store.js';
import { createPermissiveMemoryWritePolicy } from './write-policy.js';
import type { MemoryOwner } from './record.js';

const alice: MemoryOwner = { type: 'user', id: 'alice' };
const bob: MemoryOwner = { type: 'user', id: 'bob' };

describe('createInMemoryMemoryStore', () => {
  it('put/get round-trips a record and stamps createdAt/updatedAt', async () => {
    const store = createInMemoryMemoryStore();
    const record = await store.put({ type: 'durable', owner: alice, tenantId: 't1', value: 'prefers dark mode' });
    expect(record.id).toBeTruthy();
    expect(record.createdAt).toBe(record.updatedAt);

    const fetched = await store.get({ id: record.id, owner: alice, tenantId: 't1' });
    expect(fetched?.value).toBe('prefers dark mode');
  });

  it('memory ownership - a different owner cannot read or write another user\'s memory (TEST 164)', async () => {
    const store = createInMemoryMemoryStore();
    const record = await store.put({ type: 'durable', owner: alice, tenantId: 't1', value: 'secret preference' });
    await expect(store.get({ id: record.id, owner: bob, tenantId: 't1' })).rejects.toThrow(CopilotError);
    await expect(
      store.put({ id: record.id, type: 'durable', owner: bob, tenantId: 't1', value: 'overwritten' }),
    ).rejects.toThrow(CopilotError);
  });

  it('memory tenant isolation - tenant A memory must not leak to tenant B (TEST 165)', async () => {
    const store = createInMemoryMemoryStore();
    const record = await store.put({ type: 'durable', owner: alice, tenantId: 'tenant-a', value: 'note' });
    await expect(store.get({ id: record.id, owner: alice, tenantId: 'tenant-b' })).rejects.toThrow(CopilotError);

    const resultsA = await store.search({ owner: alice, tenantId: 'tenant-a' });
    const resultsB = await store.search({ owner: alice, tenantId: 'tenant-b' });
    expect(resultsA.map((r) => r.record.id)).toEqual([record.id]);
    expect(resultsB).toEqual([]);
  });

  it('never returns expired memory (TEST 166 / Section 103)', async () => {
    let now = new Date('2026-01-01T00:00:00.000Z');
    const store = createInMemoryMemoryStore({ now: () => now });
    const record = await store.put({
      type: 'session',
      owner: alice,
      tenantId: 't1',
      value: 'temporary',
      expiresAt: '2026-01-01T01:00:00.000Z',
    });

    now = new Date('2026-01-01T00:30:00.000Z');
    expect(await store.get({ id: record.id, owner: alice, tenantId: 't1' })).not.toBeNull();

    now = new Date('2026-01-01T02:00:00.000Z');
    expect(await store.get({ id: record.id, owner: alice, tenantId: 't1' })).toBeNull();
    expect(await store.search({ owner: alice, tenantId: 't1' })).toEqual([]);
  });

  it('deleted memory is never retrieved again (TEST 167)', async () => {
    const store = createInMemoryMemoryStore();
    const record = await store.put({ type: 'durable', owner: alice, tenantId: 't1', value: 'note' });
    await store.delete({ id: record.id, owner: alice, tenantId: 't1' });
    expect(await store.get({ id: record.id, owner: alice, tenantId: 't1' })).toBeNull();
  });

  it('deletes by owner and by type without affecting other owners/types', async () => {
    const store = createInMemoryMemoryStore();
    const a1 = await store.put({ type: 'durable', owner: alice, tenantId: 't1', value: '1' });
    const a2 = await store.put({ type: 'session', owner: alice, tenantId: 't1', value: '2' });
    const b1 = await store.put({ type: 'durable', owner: bob, tenantId: 't1', value: '3' });

    await store.delete({ tenantId: 't1', owner: alice, type: 'durable' });
    expect(await store.get({ id: a1.id, owner: alice, tenantId: 't1' })).toBeNull();
    expect(await store.get({ id: a2.id, owner: alice, tenantId: 't1' })).not.toBeNull();
    expect(await store.get({ id: b1.id, owner: bob, tenantId: 't1' })).not.toBeNull();
  });

  it('refuses an unfiltered delete, to avoid clearing the entire store', async () => {
    const store = createInMemoryMemoryStore();
    // @ts-expect-error Runtime guard also rejects untyped callers without an owner.
    await expect(store.delete({})).rejects.toThrow(CopilotError);
  });

  it('rejects a sensitive write via the default write policy (TEST 168)', async () => {
    const store = createInMemoryMemoryStore();
    await expect(
      store.put({ type: 'durable', owner: alice, tenantId: 't1', value: 'api_key=sk-abcdefghijklmnopqrstuvwx' }),
    ).rejects.toThrow(CopilotError);
  });

  it('allows a sensitive write when an explicit permissive policy is supplied', async () => {
    const store = createInMemoryMemoryStore({ writePolicy: createPermissiveMemoryWritePolicy() });
    const record = await store.put({ type: 'durable', owner: alice, tenantId: 't1', value: 'sk-abcdefghijklmnopqrstuvwx' });
    expect(record.value).toBe('sk-abcdefghijklmnopqrstuvwx');
  });

  it('replace mode fully replaces the value (default)', async () => {
    const store = createInMemoryMemoryStore();
    const first = await store.put({ type: 'durable', owner: alice, tenantId: 't1', value: { language: 'en', tone: 'formal' } });
    const second = await store.put(
      { id: first.id, type: 'durable', owner: alice, tenantId: 't1', value: { tone: 'concise' } },
      'replace',
    );
    expect(second.value).toEqual({ tone: 'concise' });
    expect(second.createdAt).toBe(first.createdAt);
  });

  it('merge mode shallow-merges plain-object values (Section 105)', async () => {
    const store = createInMemoryMemoryStore();
    const first = await store.put({ type: 'durable', owner: alice, tenantId: 't1', value: { language: 'en', tone: 'formal' } });
    const second = await store.put(
      { id: first.id, type: 'durable', owner: alice, tenantId: 't1', value: { tone: 'concise' } },
      'merge',
    );
    expect(second.value).toEqual({ language: 'en', tone: 'concise' });
  });

  it('idempotent re-indexing: putting the same id repeatedly never creates duplicates (Section 131)', async () => {
    const store = createInMemoryMemoryStore();
    const record = await store.put({ type: 'durable', owner: alice, tenantId: 't1', value: 'v1' });
    await store.put({ id: record.id, type: 'durable', owner: alice, tenantId: 't1', value: 'v2' });
    await store.put({ id: record.id, type: 'durable', owner: alice, tenantId: 't1', value: 'v3' });
    const results = await store.search({ owner: alice, tenantId: 't1' });
    expect(results).toHaveLength(1);
    expect(results[0]?.record.value).toBe('v3');
  });

  it('performs semantic search when an embedding provider is supplied (Section 93/113)', async () => {
    const store = createInMemoryMemoryStore({ embeddingProvider: createDeterministicEmbeddingProvider() });
    await store.put({ type: 'semantic', owner: alice, tenantId: 't1', value: 'Project Alpha uses PostgreSQL.' });
    await store.put({ type: 'semantic', owner: alice, tenantId: 't1', value: 'The weather today is sunny.' });

    const results = await store.search({ owner: alice, tenantId: 't1', text: 'What database does Project Alpha use?' });
    expect(results[0]?.record.value).toContain('PostgreSQL');
    expect(results[0]?.score).toBeGreaterThan(0);
  });

  it('falls back to a most-recently-updated listing without an embedding provider', async () => {
    let now = new Date('2026-01-01T00:00:00.000Z');
    const store = createInMemoryMemoryStore({ now: () => now });
    await store.put({ type: 'working', owner: alice, tenantId: 't1', value: 'first' });
    now = new Date('2026-01-01T00:00:01.000Z');
    const second = await store.put({ type: 'working', owner: alice, tenantId: 't1', value: 'second' });
    const results = await store.search({ owner: alice, tenantId: 't1' });
    expect(results[0]?.record.id).toBe(second.id);
  });
});
