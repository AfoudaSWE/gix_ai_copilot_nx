import { createInMemoryMemoryStore, createMemoryService, createPermissiveMemoryWritePolicy } from '@gixcopilot/memory';
import type { MemoryOwner, MemoryRecord, MemorySearchResult, MemoryService, MemoryStore, MemoryType } from '@gixcopilot/memory';
import type { SecurityContext } from '@gixcopilot/security';
import { fail } from './assert.js';

export interface MemoryFixtureRecord {
  readonly type: MemoryType;
  readonly owner: MemoryOwner;
  readonly value: unknown;
  readonly tenantId?: string;
  readonly id?: string;
  readonly expiresAt?: string;
}

export interface MemoryFixture {
  readonly store: MemoryStore;
  /** Every record the fixture was seeded with, as stored. */
  readonly seeded: readonly MemoryRecord[];
  /** The real memory service, bound to a trusted identity (never model input). */
  serviceFor(securityContext: SecurityContext): MemoryService;
  /** Every record currently held for an owner - for write assertions. */
  recordsOf(owner: MemoryOwner, tenantId?: string): Promise<readonly MemoryRecord[]>;
}

/**
 * Deterministic, scoped memory (Section 81, 190) seeded across working/session/durable/
 * semantic types and several owners, on the REAL in-memory store and memory service - so
 * owner/tenant isolation in tests is the production isolation, not a stub's.
 */
export async function createMemoryFixture(options: { readonly records?: readonly MemoryFixtureRecord[]; readonly now?: () => Date } = {}): Promise<MemoryFixture> {
  const store = createInMemoryMemoryStore({ writePolicy: createPermissiveMemoryWritePolicy(), now: options.now });
  const seeded: MemoryRecord[] = [];
  for (const record of options.records ?? []) {
    seeded.push(await store.put({ id: record.id, type: record.type, owner: record.owner, value: record.value, tenantId: record.tenantId, expiresAt: record.expiresAt, provenance: 'explicit-user-save' }));
  }
  return {
    store,
    seeded,
    serviceFor: (securityContext) => createMemoryService({ store, securityContext, persistence: 'application-policy' }),
    recordsOf: async (owner, tenantId) => (await store.search({ owner, tenantId, topK: 1_000 })).map((result) => result.record),
  };
}

function values(results: readonly MemorySearchResult[] | readonly MemoryRecord[]): unknown[] {
  return results.map((entry) => ('record' in entry ? entry.record.value : entry.value));
}

/** Memory assertions (Section 82). */
export function expectMemoryRetrieved(results: readonly MemorySearchResult[], value: unknown): void {
  if (!values(results).some((candidate) => JSON.stringify(candidate) === JSON.stringify(value))) {
    fail(`Expected memory ${JSON.stringify(value)} to be retrieved.`, values(results));
  }
}

export function expectMemoryNotRetrieved(results: readonly MemorySearchResult[], value: unknown): void {
  if (values(results).some((candidate) => JSON.stringify(candidate) === JSON.stringify(value))) {
    fail(`Expected memory ${JSON.stringify(value)} NOT to be retrieved, but it was.`);
  }
}

export async function expectMemoryWritten(fixture: MemoryFixture, owner: MemoryOwner, value: unknown, tenantId?: string): Promise<void> {
  const records = await fixture.recordsOf(owner, tenantId);
  if (!records.some((record) => JSON.stringify(record.value) === JSON.stringify(value))) fail(`Expected ${owner.type}:${owner.id} to have memory ${JSON.stringify(value)}.`, values(records));
}

export async function expectMemoryNotWritten(fixture: MemoryFixture, owner: MemoryOwner, value: unknown, tenantId?: string): Promise<void> {
  const records = await fixture.recordsOf(owner, tenantId);
  if (records.some((record) => JSON.stringify(record.value) === JSON.stringify(value))) fail(`Expected ${owner.type}:${owner.id} NOT to have memory ${JSON.stringify(value)}.`);
}

/** Asserts a caller cannot read another owner's record by id or by search (Section 82). */
export async function expectMemoryInaccessible(fixture: MemoryFixture, securityContext: SecurityContext, record: MemoryRecord): Promise<void> {
  const service = fixture.serviceFor(securityContext);
  const direct = await service.get(record.id).catch(() => null);
  if (direct) fail(`Record ${record.id} owned by ${record.owner.type}:${record.owner.id} was readable by ${securityContext.identity?.subject ?? 'anonymous'}.`);
  const found = await service.search({ topK: 1_000 }).catch(() => []);
  if (found.some((result) => result.record.id === record.id)) fail(`Record ${record.id} leaked into another caller's search results.`);
}
