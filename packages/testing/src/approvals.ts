import { createInMemoryApprovalStore } from '@gixcopilot/security';
import type { ApprovalRequest, ApprovalStore } from '@gixcopilot/security';
import { fail } from './assert.js';
import type { FakeClock } from './clock.js';

export interface ApprovalFixture {
  /** The REAL Phase 7 approval state machine - hand it to the workflow engine / server. */
  readonly store: ApprovalStore;
  pending(runId?: string): Promise<readonly ApprovalRequest[]>;
  /** Records a HUMAN decision by `approver` - the only way a pending approval resolves. */
  approve(approvalId: string, approver: string, comment?: string): Promise<ApprovalRequest>;
  reject(approvalId: string, approver: string, reason?: string): Promise<ApprovalRequest>;
  /** Expires it at the fake clock's current time. */
  expire(approvalId: string): Promise<ApprovalRequest>;
  /** Decides the single pending approval of a run (fails loudly if there isn't exactly one). */
  decideOnly(runId: string, decision: 'approve' | 'reject', approver: string): Promise<ApprovalRequest>;
}

/**
 * Simulated approvals for tests (Section 85, 191) - TESTING INFRASTRUCTURE ONLY. Decisions go
 * through the real `ApprovalStore` with an explicit human approver subject, exactly as a
 * reviewer would record them. Nothing here reads model output, so a model can never "approve"
 * anything through this fixture (Phase 10 Section 207 holds in tests too).
 */
export function createApprovalFixture(options: { readonly clock?: FakeClock; readonly store?: ApprovalStore } = {}): ApprovalFixture {
  const store = options.store ?? createInMemoryApprovalStore();
  const now = (): Date | undefined => options.clock?.now();
  const fixture: ApprovalFixture = {
    store,
    pending: (runId) => store.list({ status: 'pending', runId }),
    approve: (approvalId, approver, comment) => store.approve(approvalId, approver, comment, now()),
    reject: (approvalId, approver, reason) => store.reject(approvalId, approver, reason, now()),
    expire: (approvalId) => store.expire(approvalId, now()),
    async decideOnly(runId, decision, approver) {
      const pending = await store.list({ status: 'pending', runId });
      const [only] = pending;
      if (!only || pending.length !== 1) fail(`Expected exactly one pending approval for run ${runId}, found ${pending.length}.`, pending);
      return decision === 'approve' ? fixture.approve(only.approvalId, approver) : fixture.reject(only.approvalId, approver);
    },
  };
  return fixture;
}
