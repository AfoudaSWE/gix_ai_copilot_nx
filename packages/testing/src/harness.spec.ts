import { describe, expect, it } from 'vitest';
import { createPolicyRegistry, definePolicy, deny, allow } from '@gixcopilot/security';
import { agentTree, toolTimeline } from '@gixcopilot/devtools';
import { TestAssertionError } from './assert.js';
import { createApprovalFixture } from './approvals.js';
import { createFakeClock } from './clock.js';
import { createCopilotTestHarness } from './harness.js';
import { createKnowledgeFixture, expectAclApplied, expectCitation, expectSourceNotRetrieved, expectSourceRetrieved } from './knowledge.js';
import { createMemoryFixture, expectMemoryInaccessible, expectMemoryNotRetrieved, expectMemoryRetrieved, expectMemoryWritten } from './memory.js';
import { createTestModel, toolThenAnswer } from './model.js';
import { createSecurityFixture, expectActionAllowed, expectActionDenied, expectApprovalRequired, expectToolUnavailable } from './security.js';
import { createToolMocks, expectToolCalled, expectToolNotCalled, expectToolOrder } from './tools.js';

function applicationTools() {
  const mocks = createToolMocks();
  mocks.mock('applications.get', { result: { id: 'APP-1024', status: 'under_review' }, security: { risk: 'read-only' } });
  mocks.mock('applications.archive', { result: { archived: true }, security: { risk: 'write', approval: 'none' } });
  mocks.mock('applications.update', { result: { updated: true }, security: { risk: 'write', approval: 'supervisor' } });
  mocks.mock('admin.deleteUser', { result: { deleted: true }, security: { requiredPermissions: ['admin.users.delete'], risk: 'destructive' } });
  return mocks;
}

const noArchiving = createPolicyRegistry([
  definePolicy({ id: 'no-archiving-open-applications', appliesTo: 'applications.archive', evaluate: () => deny('Open applications cannot be archived.') }),
  definePolicy({ id: 'default', evaluate: () => allow() }),
]);

describe('createCopilotTestHarness + tool mocks (Section 72, 76-78, 188)', () => {
  it('runs a real agent loop against mocked tools and asserts calls, arguments and order', async () => {
    const mocks = applicationTools();
    const harness = createCopilotTestHarness({
      model: createTestModel(toolThenAnswer([{ name: 'applications.get', arguments: { id: 'APP-1024' } }], 'APP-1024 is under review.')),
      tools: mocks,
      security: createSecurityFixture({ subject: 'user-1', tenantId: 'tenant-a' }),
    });
    const run = await harness.run('What is the status of APP-1024?');
    expect(run.answer).toBe('APP-1024 is under review.');
    expectToolCalled(mocks, 'applications.get', { times: 1, withArguments: { id: 'APP-1024' } });
    expectToolNotCalled(mocks, 'applications.update');
    expectToolOrder(mocks, ['applications.get']);
    expect(() => expectToolCalled(mocks, 'applications.update')).toThrow(TestAssertionError);
    // The same run, as DevTools shows it (Section 219).
    expect(toolTimeline(run.session).map((entry) => [entry.name, entry.securityDecision])).toEqual([['applications.get', 'allow']]);
    expect(agentTree(run.session)[0]?.visibleTools).toContain('applications.get');
  });

  it('security assertions read the firewall decision itself: denied, approval-required, unavailable', async () => {
    const mocks = applicationTools();
    const security = createSecurityFixture({ subject: 'user-1', tenantId: 'tenant-a', firewall: { policies: noArchiving } });
    const harness = createCopilotTestHarness({
      model: createTestModel([
        { when: (turn) => turn.toolResults.length > 0, respond: { text: 'Done.' } },
        { respond: { toolCalls: [{ name: 'applications.archive', arguments: { id: 'APP-1024' } }, { name: 'applications.update', arguments: { id: 'APP-1024' } }] } },
      ]),
      tools: mocks,
      security,
    });
    await harness.run('Archive and update APP-1024.');
    const session = harness.telemetry.session();
    expectActionDenied(session, 'applications.archive', { reasonCode: 'BUSINESS_RULE_DENIED' });
    expectApprovalRequired(session, 'applications.update', { level: 'supervisor' });
    expectToolNotCalled(mocks, 'applications.archive');
    expectToolNotCalled(mocks, 'applications.update');
    await expectToolUnavailable(security.resolver(mocks.tools), 'admin.deleteUser');
    expect(() => expectActionAllowed(session, 'applications.archive')).toThrow(TestAssertionError);
  });

  it('a tool timeout and a tool failure surface as real tool errors', async () => {
    const mocks = createToolMocks();
    mocks.mock('slow.lookup', { delayMs: 500 });
    mocks.mock('broken.lookup', { error: { code: 'TOOL_EXECUTION_ERROR', message: 'downstream 503' } });
    const harness = createCopilotTestHarness({
      model: createTestModel([
        { when: (turn) => turn.toolResults.length >= 2, respond: { text: 'Both failed.' } },
        { respond: { toolCalls: [{ name: 'slow.lookup' }, { name: 'broken.lookup' }] } },
      ]),
      tools: mocks,
      toolTimeoutMs: 20,
    });
    const run = await harness.run('Look both up.');
    expect(run.answer).toBe('Both failed.');
    // The runtime gave up at 20ms; the call was made and is still pending (see Phase 11 Issues).
    expect(mocks.callsTo('slow.lookup')[0]?.outcome).toBe('pending');
    expect(toolTimeline(run.session).find((entry) => entry.name === 'slow.lookup')?.error?.code).toBe('TIMEOUT');
    expect(mocks.callsTo('broken.lookup')[0]?.outcome).toBe('failed');
    expect(toolTimeline(run.session).every((entry) => entry.status === 'failed')).toBe(true);
  });
});

describe('knowledge fixture (Section 79-80, 189)', () => {
  const documents = [
    { id: 'application-policy', content: 'An application is approved once identity and payment are verified.' },
    { id: 'hr-salaries', content: 'Confidential: application reviewer salaries and bonuses.', permissions: ['hr.read'] },
  ];

  it('retrieves deterministically and applies the real ACL filter', async () => {
    const knowledge = await createKnowledgeFixture({ documents, tenantId: 'tenant-a' });
    const viewer = createSecurityFixture({ subject: 'viewer', tenantId: 'tenant-a' }).securityContext;
    const hr = createSecurityFixture({ subject: 'hr-1', permissions: ['hr.read'], tenantId: 'tenant-a' }).securityContext;
    const asViewer = await knowledge.retrieve('application reviewer approval', viewer);
    expectSourceRetrieved(asViewer, 'application-policy');
    expectCitation(asViewer, 'application-policy');
    expectSourceNotRetrieved(asViewer, 'hr-salaries');
    await expectAclApplied(knowledge, 'application reviewer salaries', { restrictedSource: 'hr-salaries', authorized: hr, unauthorized: viewer });
    expectSourceRetrieved(await knowledge.retrieve('application reviewer salaries', hr), 'hr-salaries');
    const again = await knowledge.retrieve('application reviewer approval', viewer);
    expect(again.citations).toEqual(asViewer.citations);
  });
});

describe('memory fixture (Section 81-82, 190)', () => {
  it('scopes memory to its owner across every memory type', async () => {
    const memory = await createMemoryFixture({
      records: [
        { type: 'durable', owner: { type: 'user', id: 'user-1' }, value: 'prefers email', tenantId: 'tenant-a' },
        { type: 'session', owner: { type: 'user', id: 'user-1' }, value: 'viewing APP-1024', tenantId: 'tenant-a' },
        { type: 'working', owner: { type: 'user', id: 'user-2' }, value: 'user-2 private note', tenantId: 'tenant-a' },
        { type: 'semantic', owner: { type: 'user', id: 'user-2' }, value: 'user-2 salary', tenantId: 'tenant-a' },
      ],
    });
    const user1 = createSecurityFixture({ subject: 'user-1', tenantId: 'tenant-a' }).securityContext;
    const results = await memory.serviceFor(user1).search({ topK: 10 });
    expectMemoryRetrieved(results, 'prefers email');
    expectMemoryRetrieved(results, 'viewing APP-1024');
    expectMemoryNotRetrieved(results, 'user-2 private note');
    const user2Record = memory.seeded.find((record) => record.owner.id === 'user-2');
    if (!user2Record) throw new Error('fixture missing user-2 record');
    await expectMemoryInaccessible(memory, user1, user2Record);
  });

  it('a harness memory write lands on the trusted caller, never an arbitrary owner', async () => {
    const memory = await createMemoryFixture();
    const harness = createCopilotTestHarness({
      model: createTestModel(toolThenAnswer([{ name: 'memory.save', arguments: { value: 'likes weekly summaries' } }], 'Saved.')),
      memory,
      security: createSecurityFixture({ subject: 'user-1', tenantId: 'tenant-a' }),
    });
    await harness.run('Remember I like weekly summaries.');
    await expectMemoryWritten(memory, { type: 'user', id: 'user-1' }, 'likes weekly summaries', 'tenant-a');
  });
});

describe('approval fixture (Section 85, 191)', () => {
  const input = (approvalId: string) => ({ approvalId, actionId: approvalId, runId: 'run-1', approvalLevel: 'supervisor' as const, summary: 'Update APP-1024', expiresInMs: 60_000 });

  it('approves, rejects and expires through the real approval store with a fake clock', async () => {
    const clock = createFakeClock();
    const approvals = createApprovalFixture({ clock });
    await approvals.store.create(input('a1'), clock.now());
    await approvals.store.create(input('a2'), clock.now());
    await approvals.store.create(input('a3'), clock.now());
    expect(await approvals.approve('a1', 'supervisor-1')).toMatchObject({ status: 'approved' });
    expect(await approvals.reject('a2', 'supervisor-1', 'insufficient docs')).toMatchObject({ status: 'rejected' });
    clock.advance(61_000);
    expect(await approvals.expire('a3')).toMatchObject({ status: 'expired' });
    expect(await approvals.pending('run-1')).toEqual([]);
  });
});
