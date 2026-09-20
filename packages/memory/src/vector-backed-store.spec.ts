import { describe, expect, it } from 'vitest';
import { createDeterministicEmbeddingProvider, createInMemoryVectorStore } from '@gixcopilot/rag';
import { CopilotError } from '@gixcopilot/protocol';
import { createVectorBackedMemoryStore } from './vector-backed-store.js';
import { createPermissiveMemoryWritePolicy } from './write-policy.js';
import type { MemoryOwner } from './record.js';

const alice: MemoryOwner = { type: 'user', id: 'alice' };
const bob: MemoryOwner = { type: 'user', id: 'bob' };

function makeStore(now?: () => Date) {
  return createVectorBackedMemoryStore({
    vectorStore: createInMemoryVectorStore(),
    embeddingProvider: createDeterministicEmbeddingProvider(),
    ...(now ? { now } : {}),
  });
}

describe('createVectorBackedMemoryStore', () => {
  it('put/get round-trips a record through the underlying VectorStore', async () => {
    const store = makeStore();
    const record = await store.put({ type: 'durable', owner: alice, tenantId: 't1', value: 'prefers dark mode' });
    const fetched = await store.get({ id: record.id, owner: alice, tenantId: 't1' });
    expect(fetched?.value).toBe('prefers dark mode');
    expect(fetched?.owner).toEqual(alice);
  });

  it('round-trips a structured (non-string) value', async () => {
    const store = makeStore();
    const record = await store.put({ type: 'durable', owner: alice, tenantId: 't1', value: { tone: 'concise' } });
    const fetched = await store.get({ id: record.id, owner: alice, tenantId: 't1' });
    expect(fetched?.value).toEqual({ tone: 'concise' });
  });

  it('memory ownership - a different owner cannot read alice\'s memory, and cannot overwrite it even by reusing her id (TEST 164)', async () => {
    const store = makeStore();
    const record = await store.put({ type: 'durable', owner: alice, tenantId: 't1', value: 'secret preference' });
    await expect(store.get({ id: record.id, owner: bob, tenantId: 't1' })).resolves.toBeNull();

    // Storage is owner-partitioned (`ownerKey::id`, Section 114): bob reusing alice's id
    // creates his own separate record rather than being denied outright, but it can never
    // read or overwrite alice's - her original is left completely untouched.
    await store.put({ id: record.id, type: 'durable', owner: bob, tenantId: 't1', value: 'overwritten' });
    const aliceStillOwns = await store.get({ id: record.id, owner: alice, tenantId: 't1' });
    expect(aliceStillOwns?.value).toBe('secret preference');
  });

  it('memory tenant isolation - a search never returns another tenant\'s memory (TEST 165)', async () => {
    const store = makeStore();
    await store.put({ type: 'durable', owner: alice, tenantId: 'tenant-a', value: 'Project Alpha uses PostgreSQL.' });
    const resultsA = await store.search({ owner: alice, tenantId: 'tenant-a', text: 'What database does Project Alpha use?' });
    const resultsB = await store.search({ owner: alice, tenantId: 'tenant-b', text: 'What database does Project Alpha use?' });
    expect(resultsA.length).toBeGreaterThan(0);
    expect(resultsB).toEqual([]);
  });

  it('never returns expired memory (TEST 166)', async () => {
    let now = new Date('2026-01-01T00:00:00.000Z');
    const store = makeStore(() => now);
    const record = await store.put({
      type: 'durable',
      owner: alice,
      tenantId: 't1',
      value: 'temporary fact',
      expiresAt: '2026-01-01T01:00:00.000Z',
    });

    now = new Date('2026-01-01T02:00:00.000Z');
    expect(await store.get({ id: record.id, owner: alice, tenantId: 't1' })).toBeNull();
  });

  it('deleted memory is never retrieved again (TEST 167)', async () => {
    const store = makeStore();
    const record = await store.put({ type: 'durable', owner: alice, tenantId: 't1', value: 'note' });
    await store.delete({ tenantId: 't1', owner: alice, id: record.id });
    expect(await store.get({ id: record.id, owner: alice, tenantId: 't1' })).toBeNull();
  });

  it('supports an owner-scoped listing without embedding a query', async () => {
    const store = makeStore();
    await expect(store.search({ owner: alice, tenantId: 't1' })).resolves.toEqual([]);
  });

  it('refuses an unscoped delete, to avoid clearing the entire table', async () => {
    const store = makeStore();
    // @ts-expect-error Runtime guard also rejects untyped callers without an owner.
    await expect(store.delete({})).rejects.toThrow(CopilotError);
  });

  it('rejects a sensitive write via the default write policy (TEST 168)', async () => {
    const store = makeStore();
    await expect(
      store.put({ type: 'durable', owner: alice, tenantId: 't1', value: 'password: hunter22222' }),
    ).rejects.toThrow(CopilotError);
  });

  it('allows a sensitive write when an explicit permissive policy is supplied', async () => {
    const store = createVectorBackedMemoryStore({
      vectorStore: createInMemoryVectorStore(),
      embeddingProvider: createDeterministicEmbeddingProvider(),
      writePolicy: createPermissiveMemoryWritePolicy(),
    });
    const record = await store.put({ type: 'durable', owner: alice, tenantId: 't1', value: 'password: hunter22222' });
    expect(record.value).toBe('password: hunter22222');
  });

  it('merge mode shallow-merges plain-object values across updates to the same id (Section 105)', async () => {
    const store = makeStore();
    const first = await store.put({ type: 'durable', owner: alice, tenantId: 't1', value: { language: 'en', tone: 'formal' } });
    const second = await store.put(
      { id: first.id, type: 'durable', owner: alice, tenantId: 't1', value: { tone: 'concise' } },
      'merge',
    );
    expect(second.value).toEqual({ language: 'en', tone: 'concise' });
  });

  it('idempotent re-indexing: putting the same id repeatedly never creates duplicate matches (Section 131)', async () => {
    const store = makeStore();
    const record = await store.put({ type: 'durable', owner: alice, tenantId: 't1', value: 'Project Alpha uses PostgreSQL.' });
    await store.put({ id: record.id, type: 'durable', owner: alice, tenantId: 't1', value: 'Project Alpha uses PostgreSQL and Redis.' });
    const results = await store.search({ owner: alice, tenantId: 't1', text: 'What does Project Alpha use?' });
    expect(results).toHaveLength(1);
    expect(results[0]?.record.value).toContain('Redis');
  });

  it('a durable/semantic store keeps different owners\' memory in entirely separate namespaces (Section 114)', async () => {
    const store = makeStore();
    await store.put({ type: 'semantic', owner: alice, tenantId: 't1', value: 'Alice likes PostgreSQL.' });
    await store.put({ type: 'semantic', owner: bob, tenantId: 't1', value: 'Bob likes PostgreSQL.' });
    const results = await store.search({ owner: alice, tenantId: 't1', text: 'What does the user like?' });
    expect(results.every((r) => r.record.owner.id === 'alice')).toBe(true);
  });
});
