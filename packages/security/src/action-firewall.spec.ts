import { describe, expect, it } from 'vitest';
import { createActionFirewall } from './action-firewall.js';
import { createPolicyRegistry, definePolicy, deny } from './policy.js';
import { createInMemoryAuditSink } from './audit.js';
import { createFixedWindowRateLimiter } from './rate-limit.js';
import type { ActionRequest } from './action-request.js';
import type { SecurityContext } from './identity.js';

const roleMap = {
  APPLICATION_VIEWER: ['applications.view'],
  APPLICATION_MANAGER: ['applications.view', 'applications.reassign'],
  ADMIN: ['applications.view', 'applications.reassign', 'applications.delete'],
};

function request(overrides: Partial<ActionRequest> = {}): ActionRequest {
  return {
    actionId: 'act1',
    runId: 'run1',
    toolCallId: 'call1',
    action: 'applications.get',
    arguments: { applicationId: 'APP-1024' },
    metadata: { toolName: 'applications.get', source: 'backend', risk: 'read-only' },
    ...overrides,
  };
}

const viewerContext: SecurityContext = {
  identity: { subject: 'u-viewer', roles: ['APPLICATION_VIEWER'], permissions: [] },
};
const managerContext: SecurityContext = {
  identity: { subject: 'u-manager', roles: ['APPLICATION_MANAGER'], permissions: [] },
};
const adminContext: SecurityContext = {
  identity: { subject: 'u-admin', roles: ['ADMIN'], permissions: [] },
};

describe('createActionFirewall', () => {
  it('denies AUTHENTICATION_REQUIRED when there is no identity (Section 96-98)', async () => {
    const firewall = createActionFirewall();
    const decision = await firewall.evaluate(request(), {});
    expect(decision.decision).toBe('deny');
    expect(decision.decision === 'deny' && decision.reason.code).toBe('AUTHENTICATION_REQUIRED');
    expect(decision.decision === 'deny' && decision.reason.message.length > 0).toBe(true);
  });

  it('a model-supplied "role: ADMIN" argument never grants authority (Section 98)', async () => {
    const firewall = createActionFirewall({ roleMap });
    const decision = await firewall.evaluate(
      request({
        action: 'applications.delete',
        arguments: { applicationId: 'APP-1024', role: 'ADMIN' }, // Untrusted, must be ignored.
        metadata: {
          toolName: 'applications.delete',
          source: 'backend',
          risk: 'destructive',
          requiredPermissions: ['applications.delete'],
        },
      }),
      viewerContext, // Trusted identity only has APPLICATION_VIEWER - not admin.
    );
    expect(decision.decision).toBe('deny');
    expect(decision.decision === 'deny' && decision.reason.code).toBe('PERMISSION_DENIED');
  });

  it('allows a read-only action for a holder of the required permission, with no approval', async () => {
    const firewall = createActionFirewall({
      roleMap,
    });
    const decision = await firewall.evaluate(
      request({ metadata: { toolName: 'applications.get', source: 'backend', risk: 'read-only', requiredPermissions: ['applications.view'] } }),
      viewerContext,
    );
    expect(decision).toEqual({ decision: 'allow' });
  });

  it('denies PERMISSION_DENIED for a missing required permission, without ever calling the tool (Section 97)', async () => {
    const firewall = createActionFirewall({ roleMap });
    const decision = await firewall.evaluate(
      request({
        action: 'applications.delete',
        metadata: {
          toolName: 'applications.delete',
          source: 'backend',
          risk: 'destructive',
          requiredPermissions: ['applications.delete'],
        },
      }),
      managerContext, // Manager can reassign but not delete.
    );
    expect(decision.decision).toBe('deny');
    expect(decision.decision === 'deny' && decision.reason.code).toBe('PERMISSION_DENIED');
  });

  it('a write action requires approval per the default risk policy', async () => {
    const firewall = createActionFirewall({ roleMap });
    const decision = await firewall.evaluate(
      request({
        action: 'applications.reassign',
        metadata: {
          toolName: 'applications.reassign',
          source: 'backend',
          risk: 'write',
          reversibility: 'reversible',
          requiredPermissions: ['applications.reassign'],
        },
      }),
      managerContext,
    );
    expect(decision).toEqual({ decision: 'approval', approval: { level: 'user-confirmation' } });
  });

  it('an explicit tool-declared approval level overrides the computed default', async () => {
    const firewall = createActionFirewall({ roleMap });
    const decision = await firewall.evaluate(
      request({
        action: 'applications.reassign',
        metadata: {
          toolName: 'applications.reassign',
          source: 'backend',
          risk: 'write',
          approval: 'supervisor',
          requiredPermissions: ['applications.reassign'],
        },
      }),
      managerContext,
    );
    expect(decision).toEqual({ decision: 'approval', approval: { level: 'supervisor' } });
  });

  it('a destructive action requires the stronger admin-level approval (Section 95 example)', async () => {
    const firewall = createActionFirewall({ roleMap });
    const decision = await firewall.evaluate(
      request({
        action: 'applications.delete',
        metadata: {
          toolName: 'applications.delete',
          source: 'backend',
          risk: 'destructive',
          reversibility: 'irreversible',
          requiredPermissions: ['applications.delete'],
        },
      }),
      adminContext,
    );
    expect(decision).toEqual({ decision: 'approval', approval: { level: 'admin' } });
  });

  it('an ABAC/business policy denial is surfaced with its own reason code (Section 60)', async () => {
    const policies = createPolicyRegistry();
    policies.register(
      definePolicy({
        id: 'applications.reassignment-status',
        appliesTo: 'applications.reassign',
        evaluate: () => deny('Approved applications cannot be reassigned.', 'BUSINESS_RULE_DENIED'),
      }),
    );
    const firewall = createActionFirewall({ roleMap, policies });
    const decision = await firewall.evaluate(
      request({
        action: 'applications.reassign',
        metadata: {
          toolName: 'applications.reassign',
          source: 'backend',
          risk: 'write',
          requiredPermissions: ['applications.reassign'],
        },
      }),
      managerContext,
    );
    expect(decision.decision).toBe('deny');
    expect(decision.decision === 'deny' && decision.reason.code).toBe('BUSINESS_RULE_DENIED');
  });

  it('enforces a configured rate limit (Section 68-69, per-identity per the security skill)', async () => {
    // The firewall keys the limiter by `${identity.subject}:${action}` (per user, per the
    // security skill's "rate limiting applies per user/tenant/API key") - see
    // action-firewall.ts's doc comment on `rateLimiter`.
    const rateLimiter = createFixedWindowRateLimiter({
      'u-viewer:applications.get': { limit: 1, windowMs: 60_000 },
    });
    const firewall = createActionFirewall({ roleMap, rateLimiter });
    const req = request({ metadata: { toolName: 'applications.get', source: 'backend', risk: 'read-only', requiredPermissions: ['applications.view'] } });
    const first = await firewall.evaluate(req, viewerContext);
    const second = await firewall.evaluate(req, viewerContext);
    expect(first.decision).toBe('allow');
    expect(second.decision).toBe('deny');
    expect(second.decision === 'deny' && second.reason.code).toBe('RATE_LIMITED');
  });

  it('writes an audit record for every decision outcome, not only denials (Section 63, 109)', async () => {
    const audit = createInMemoryAuditSink();
    const firewall = createActionFirewall({ roleMap, audit });

    await firewall.evaluate(request(), {}); // deny (unauthenticated)
    await firewall.evaluate(
      request({ metadata: { toolName: 'applications.get', source: 'backend', risk: 'read-only', requiredPermissions: ['applications.view'] } }),
      viewerContext,
    ); // allow
    await firewall.evaluate(
      request({
        action: 'applications.reassign',
        metadata: { toolName: 'applications.reassign', source: 'backend', risk: 'write', requiredPermissions: ['applications.reassign'] },
      }),
      managerContext,
    ); // approval

    const records = audit.list();
    expect(records.map((r) => r.decision)).toEqual(['deny', 'allow', 'approval']);
  });
});
