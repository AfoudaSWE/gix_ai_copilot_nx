import { randomUUID } from 'node:crypto';
import { CopilotError } from '@gixcopilot/protocol';
import type { AuditSink, SecurityContext } from '@gixcopilot/security';
import type { MemoryRecord, MemoryOwnerType } from './record.js';
import type { MemoryPutInput, MemorySearchQuery, MemorySearchResult, MemoryStore } from './store.js';
import { ownerFromSecurityContext } from './security.js';

export interface MemoryService {
  save(input: Omit<MemoryPutInput, 'owner' | 'tenantId'>, confirmed?: boolean): Promise<MemoryRecord>;
  get(id: string): Promise<MemoryRecord | null>;
  search(query?: Omit<MemorySearchQuery, 'owner' | 'tenantId'>): Promise<readonly MemorySearchResult[]>;
  forget(id?: string): Promise<void>;
}

/** Bind server-derived identity once; model/browser data cannot override owner or tenant. */
export function createMemoryService(options: {
  readonly store: MemoryStore;
  readonly securityContext: SecurityContext;
  readonly scope?: MemoryOwnerType;
  readonly persistence?: 'explicit-confirmation' | 'application-policy' | 'never';
  readonly auditSink?: AuditSink;
}): MemoryService {
  const owner = ownerFromSecurityContext(options.scope ?? 'user', options.securityContext);
  const tenantId = options.securityContext.tenant?.tenantId;
  async function audit(action: string, decision = 'allowed'): Promise<void> {
    await options.auditSink?.write({ id: randomUUID(), timestamp: new Date().toISOString(), tenantId,
      actor: { kind: 'user', subject: options.securityContext.identity?.subject }, action, decision });
  }
  return {
    async save(input, confirmed = false) {
      const mode = options.persistence ?? 'explicit-confirmation';
      if (mode === 'never' || (mode === 'explicit-confirmation' && !confirmed)) {
        await audit('memory.write', 'denied');
        throw CopilotError.memoryWriteDenied('Memory persistence requires explicit application consent.');
      }
      const record = await options.store.put({ ...input, owner, tenantId });
      await audit('memory.write');
      return record;
    },
    async get(id) {
      const record = await options.store.get({ id, owner, tenantId });
      await audit('memory.read');
      return record;
    },
    async search(query = {}) {
      const records = await options.store.search({ ...query, owner, tenantId });
      await audit('memory.search');
      return records;
    },
    async forget(id) {
      await options.store.delete({ id, owner, tenantId });
      await audit('memory.delete');
    },
  };
}
