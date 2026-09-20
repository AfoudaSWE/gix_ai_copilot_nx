import { describe, expect, it } from 'vitest';
import { createDeterministicEmbeddingProvider, createInMemoryVectorStore } from '@gixcopilot/rag';
import { createInMemoryMemoryStore } from './in-memory-store.js';
import { createVectorBackedMemoryStore } from './vector-backed-store.js';
import { createMemoryService } from './service.js';

const owner = { type: 'user', id: 'alice' } as const;
const embeddingProvider = createDeterministicEmbeddingProvider();
for (const persistent of [false, true]) {
  describe(persistent ? 'persistent memory security' : 'transient memory security', () => {
    const makeStore = () => persistent ? createVectorBackedMemoryStore({ vectorStore: createInMemoryVectorStore(), embeddingProvider }) : createInMemoryMemoryStore();
    it('tenant-scoped deletion cannot delete another tenant or global memory', async () => {
      const store = makeStore();
      const a = await store.put({ type: 'durable', owner, tenantId: 'a', value: 'A preference' });
      const b = await store.put({ type: 'durable', owner, tenantId: 'b', value: 'B preference' });
      const global = await store.put({ type: 'durable', owner, value: 'Global preference' });
      await store.delete({ owner, tenantId: 'a' });
      expect(await store.get({ id: a.id, owner, tenantId: 'a' })).toBeNull();
      expect(await store.get({ id: b.id, owner, tenantId: 'b' })).not.toBeNull();
      expect(await store.search({ owner, tenantId: 'b' })).toHaveLength(1);
      expect(await store.get({ id: global.id, owner })).not.toBeNull();
    });
    it('rejects structured secrets, secret metadata and invalid expiry dates', async () => {
      const store = makeStore();
      for (const value of [{ password: 'hunter2' }, { apiKey: 'short-key' }, { access_token: 'short-token' }]) {
        await expect(store.put({ type: 'durable', owner, value })).rejects.toThrow();
      }
      await expect(store.put({ type: 'durable', owner, value: 'safe', metadata: { password: 'secret' } })).rejects.toThrow();
      await expect(store.put({ type: 'durable', owner, value: 'safe', expiresAt: 'invalid' })).rejects.toThrow();
    });
    it('applies bounded retention and requires explicit persistence consent in the service', async () => {
      const store = makeStore();
      const service = createMemoryService({ store, securityContext: { identity: { subject: 'alice', roles: [], permissions: [] }, tenant: { tenantId: 'a' } } });
      await expect(service.save({ type: 'durable', value: 'concise' })).rejects.toThrow();
      const record = await service.save({ type: 'durable', value: 'concise' }, true);
      expect(Date.parse(record.expiresAt ?? '')).toBeGreaterThan(Date.now());
      await service.forget(record.id);
      expect(await service.search()).toEqual([]);
    });
  });
}

it('persistent colliding IDs never overwrite a different tenant; get and listing need no embedding request', async () => {
  const vectors = createInMemoryVectorStore();
  const store = createVectorBackedMemoryStore({ vectorStore: vectors, embeddingProvider });
  await store.put({ id: 'same', type: 'durable', owner, tenantId: 'a', value: 'A' });
  await store.put({ id: 'same', type: 'durable', owner, tenantId: 'b', value: 'B' });
  const offline = createVectorBackedMemoryStore({ vectorStore: vectors, embeddingProvider: { ...embeddingProvider, embedQuery: () => Promise.reject(new Error('offline')) } });
  expect((await offline.get({ id: 'same', owner, tenantId: 'a' }))?.value).toBe('A');
  expect((await offline.search({ owner, tenantId: 'b' }))[0]?.record.value).toBe('B');
});
