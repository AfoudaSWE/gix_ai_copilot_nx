/**
 * Explicit memory taxonomy (Section 87-88). Deliberately five distinct concepts, never merged:
 * conversation history already exists from earlier phases and is NOT duplicated here (Section
 * 89) - `MemoryType` only names the four kinds this package actually stores.
 *
 * - `working`  - short-lived, current run/task scratch data (Section 90). Not durable by default.
 * - `session`  - lives for the current session (Section 91). Distinct from Phase 4 application
 *   state, which is UI/app-owned; this is Copilot-owned memory about the session.
 * - `durable`  - explicit, deliberately persisted information (Section 92). Requires a write
 *   policy decision (see write-policy.ts) - never an automatic side effect of conversation.
 * - `semantic` - memory retrieved by similarity rather than by id (Section 93), backed by the
 *   same `EmbeddingProvider`/`VectorStore` abstractions as `@gixcopilot/rag`, in a separate
 *   namespace/table (Section 113-114) - never the same index as enterprise knowledge.
 */
export type MemoryType = 'working' | 'session' | 'durable' | 'semantic';

/**
 * Who a memory record belongs to (Section 95). A record must always have exactly one owner -
 * there is no "global, ownerless" memory, which is what prevents an accidental cross-user/
 * cross-tenant shared pool (Section 114).
 */
export type MemoryOwnerType = 'user' | 'session' | 'tenant' | 'workspace' | 'application';

export interface MemoryOwner {
  readonly type: MemoryOwnerType;
  readonly id: string;
}

/** Why a memory record exists (Section 111) - provenance is never hidden. */
export type MemoryProvenance = 'explicit-user-save' | 'application-generated' | 'system-policy' | 'derived-summary';

/**
 * One stored memory (Section 94). Generic over `value` the same way `ToolResult`/`VectorRecord`
 * are generic/untyped over their payload - the application decides what a memory's value shape
 * is; this package only manages its lifecycle, ownership, and security.
 */
export interface MemoryRecord<T = unknown> {
  readonly id: string;
  readonly type: MemoryType;
  readonly owner: MemoryOwner;
  /** Trusted tenant this record was written under, if any (Section 45/114 applied to memory). */
  readonly tenantId?: string;
  readonly value: T;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly expiresAt?: string;
  readonly provenance?: MemoryProvenance;
  /** True when an LLM derived/summarized this memory rather than a verbatim explicit save
   * (Section 112) - callers must not treat derived content as perfectly factual. */
  readonly derived?: boolean;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/** Expired memory must never be returned by a store (Section 103/110/166). */
export function isMemoryExpired(record: Pick<MemoryRecord, 'expiresAt'>, now: Date = new Date()): boolean {
  return record.expiresAt !== undefined && !(new Date(record.expiresAt).getTime() > now.getTime());
}

export function memoryOwnersEqual(a: MemoryOwner, b: MemoryOwner): boolean {
  return a.type === b.type && a.id === b.id;
}

/** Stable, filterable key for a `(type, id)` owner pair - used as the partition key wherever a
 * memory store needs a single string to scope a query or an underlying storage record to. */
export function memoryOwnerKey(owner: MemoryOwner): string {
  return `${owner.type}:${owner.id}`;
}
