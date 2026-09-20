import type { MemoryOwner, MemoryProvenance, MemoryRecord, MemoryType } from './record.js';

export interface MemoryPutInput<T = unknown> {
  /** Omit to generate a new record id; pass an existing id to update that record. */
  readonly id?: string;
  readonly type: MemoryType;
  readonly owner: MemoryOwner;
  readonly tenantId?: string;
  readonly value: T;
  readonly expiresAt?: string;
  readonly provenance?: MemoryProvenance;
  readonly derived?: boolean;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/**
 * Deterministic update semantics (Section 105) - a store must pick one of these, never leave
 * concurrent/contradictory durable writes to accumulate implicitly.
 *
 * - `replace` (default): the new value fully replaces the old one.
 * - `merge`: shallow-merges the new value into the old one when both are plain objects
 *   (falls back to `replace` otherwise, since there is no generic way to "merge" a primitive).
 */
export type MemoryUpdateMode = 'replace' | 'merge';

export interface MemoryGetQuery {
  readonly id: string;
  /** Mandatory: a get() is always scoped to a requester's own owner (Section 95/114). */
  readonly owner: MemoryOwner;
  readonly tenantId?: string;
}

export interface MemorySearchQuery {
  /** A semantic query string. Required by similarity-backed stores (Section 93); a store that
   * supports plain listing may treat this as optional and return the most recent records. */
  readonly text?: string;
  readonly type?: MemoryType;
  /** Mandatory: memory is never searched across owners implicitly (Section 95/114). */
  readonly owner: MemoryOwner;
  readonly tenantId?: string;
  readonly topK?: number;
  readonly threshold?: number;
}

export interface MemoryDeleteFilter {
  readonly id?: string;
  readonly owner: MemoryOwner;
  readonly tenantId?: string;
  readonly type?: MemoryType;
}

export interface MemorySearchResult {
  readonly record: MemoryRecord;
  /** Present when the match came from similarity search; absent for a plain recency listing. */
  readonly score?: number;
}

/**
 * Framework/storage-independent memory contract (Section 96). `createInMemoryMemoryStore`
 * (deterministic, Section 97) and `createVectorBackedMemoryStore` (persistent, semantic,
 * Section 98/113) both satisfy this identically - callers never depend on which one backs a
 * given `MemoryStore` value.
 */
export interface MemoryStore {
  put<T = unknown>(input: MemoryPutInput<T>, mode?: MemoryUpdateMode): Promise<MemoryRecord<T>>;
  get(query: MemoryGetQuery): Promise<MemoryRecord | null>;
  search(query: MemorySearchQuery): Promise<readonly MemorySearchResult[]>;
  delete(filter: MemoryDeleteFilter): Promise<void>;
}
