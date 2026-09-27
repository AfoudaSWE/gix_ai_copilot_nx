import { describe, expect, it } from 'vitest';
import type { SecurityContext } from '@gixcopilot/security';
import {
  assertTenantOwns,
  createConversationRecorder,
  createInMemoryConversationStore,
  requireScope,
  roleAtLeast,
  scopeFromSecurityContext,
} from './index.js';

const tenantA: SecurityContext = {
  identity: { subject: 'alice', roles: [], permissions: [], attributes: { tenantId: 'tenant-a', projectId: 'visa', environment: 'production' } },
  tenant: { tenantId: 'tenant-a' },
};
const tenantB: SecurityContext = {
  identity: { subject: 'bob', roles: [], permissions: [], attributes: { tenantId: 'tenant-b' } },
  tenant: { tenantId: 'tenant-b' },
};

describe('@gixcopilot/tenancy', () => {
  it('derives scope only from the authenticated security context', () => {
    expect(scopeFromSecurityContext(tenantA)).toEqual({ tenantId: 'tenant-a', projectId: 'visa', environment: 'production' });
    expect(scopeFromSecurityContext({})).toBeUndefined();
    expect(() => requireScope({})).toThrow(/tenant is required/);
    // Malformed tenant ids from an adapter are rejected rather than used in storage keys.
    expect(scopeFromSecurityContext({ tenant: { tenantId: "a' OR 1=1 --" } })).toBeUndefined();
    expect(() => assertTenantOwns({ tenantId: 'tenant-a' }, 'tenant-b', 'Thread t1')).toThrow(/different tenant/);
    expect(roleAtLeast('admin', 'operator')).toBe(true);
    expect(roleAtLeast('viewer', 'operator')).toBe(false);
  });

  it('a tenant-scoped store never returns another tenant’s threads, messages or runs', async () => {
    const store = createInMemoryConversationStore();
    const a = store.forTenant({ tenantId: 'tenant-a' });
    const b = store.forTenant({ tenantId: 'tenant-b' });
    await a.upsertThread({ id: 'thread-1', subject: 'alice' });
    await a.appendMessages('thread-1', [{ id: 'm1', role: 'user', content: [{ type: 'text', text: 'A secret' }], createdAt: '2026-09-27T00:00:00Z' }]);
    await a.startRun({ id: 'run-1', threadId: 'thread-1', startedAt: '2026-09-27T00:00:00Z' });

    // Same ids, other tenant: nothing visible, nothing writable.
    expect(await b.getThread('thread-1')).toBeNull();
    expect((await b.listThreads()).items).toHaveLength(0);
    expect((await b.listMessages('thread-1')).items).toHaveLength(0);
    expect(await b.getRun('run-1')).toBeNull();
    await expect(b.appendMessages('thread-1', [])).rejects.toThrow();
    expect(await b.deleteThread('thread-1')).toBe(false);
    expect(await a.getThread('thread-1')).not.toBeNull();

    // Project/environment narrowing inside one tenant.
    const staging = store.forTenant({ tenantId: 'tenant-a', projectId: 'visa', environment: 'staging' });
    await staging.upsertThread({ id: 'thread-2' });
    expect((await store.forTenant({ tenantId: 'tenant-a', projectId: 'visa', environment: 'production' }).listThreads()).items).toHaveLength(0);
    expect((await a.listThreads()).items.map((thread) => thread.id).sort()).toEqual(['thread-1', 'thread-2']);

    // User data deletion.
    expect(await a.deleteSubjectData('alice')).toBe(1);
    expect(await a.getThread('thread-1')).toBeNull();
  });

  it('the recorder persists runs under the authenticated tenant only', async () => {
    const store = createInMemoryConversationStore();
    const recorder = createConversationRecorder(store);
    const info = {
      runId: 'run-9',
      threadId: 'thread-9',
      securityContext: tenantA,
      messages: [{ role: 'user' as const, content: [{ type: 'text' as const, text: 'Hello' }] }],
      startedAt: '2026-09-27T00:00:00Z',
    };
    await recorder.onRunStarted(info);
    recorder.onEvent({ type: 'message.started', messageId: 'a1', role: 'assistant' } as never, info);
    recorder.onEvent({ type: 'message.delta', messageId: 'a1', delta: 'Hi there' } as never, info);
    await recorder.onRunEnded(info, { status: 'completed', usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 } });

    const scoped = store.forTenant({ tenantId: 'tenant-a' });
    expect((await scoped.listMessages('thread-9')).items.map((message) => message.role)).toEqual(['user', 'assistant']);
    expect(await scoped.getRun('run-9')).toMatchObject({ status: 'completed', subject: 'alice', usage: { totalTokens: 3 } });
    expect(await store.forTenant({ tenantId: 'tenant-b' }).getRun('run-9')).toBeNull();

    // Metadata-only retention keeps no message text; anonymous runs are not persisted.
    const metadataOnly = createConversationRecorder(store, { retain: 'metadata' });
    await metadataOnly.onRunStarted({ ...info, runId: 'run-10', threadId: 'thread-10', securityContext: tenantB });
    await metadataOnly.onRunEnded({ ...info, runId: 'run-10', threadId: 'thread-10', securityContext: tenantB }, { status: 'completed' });
    expect((await store.forTenant({ tenantId: 'tenant-b' }).listMessages('thread-10')).items).toHaveLength(0);
    await recorder.onRunStarted({ ...info, runId: 'anon', threadId: 'anon-thread', securityContext: {} });
    expect(await scoped.getThread('anon-thread')).toBeNull();
  });
});
