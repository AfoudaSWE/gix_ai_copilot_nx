export type { MemoryType, MemoryOwnerType, MemoryOwner, MemoryProvenance, MemoryRecord } from './record.js';
export { isMemoryExpired, memoryOwnersEqual, memoryOwnerKey } from './record.js';
// Phase 12: exported so persistent MemoryStore adapters apply the same retention rules.
export { memoryExpiry } from './retention.js';

export type {
  MemoryPutInput,
  MemoryUpdateMode,
  MemoryGetQuery,
  MemorySearchQuery,
  MemoryDeleteFilter,
  MemorySearchResult,
  MemoryStore,
} from './store.js';

export type { MemoryWriteDecision, MemoryWritePolicy } from './write-policy.js';
export { createDefaultMemoryWritePolicy, createPermissiveMemoryWritePolicy, containsSensitiveContent } from './write-policy.js';

export type { MemoryAccessRequest } from './security.js';
export { assertMemoryAccess, ownerFromSecurityContext } from './security.js';

export type { CreateInMemoryMemoryStoreOptions } from './in-memory-store.js';
export { createInMemoryMemoryStore } from './in-memory-store.js';

export type { CreateVectorBackedMemoryStoreOptions } from './vector-backed-store.js';
export { createVectorBackedMemoryStore } from './vector-backed-store.js';

export type { MemoryContextContribution } from './context.js';
export { formatMemoryContext, hasMemoryResults } from './context.js';
export { createMemoryService } from './service.js';
export type { MemoryService } from './service.js';
