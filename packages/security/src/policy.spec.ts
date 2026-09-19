import { describe, expect, it } from 'vitest';
import { allow, createPolicyRegistry, definePolicy, deny, evaluatePolicies } from './policy.js';
import type { PolicyContext } from './policy.js';

const baseContext: PolicyContext = {
  identity: { subject: 'u1', roles: [], permissions: [] },
  action: 'applications.reassign',
  input: {},
};

describe('evaluatePolicies', () => {
  it('allows when every applicable policy allows', async () => {
    const result = await evaluatePolicies(
      [definePolicy({ id: 'a', evaluate: () => allow() }), definePolicy({ id: 'b', evaluate: () => allow() })],
      baseContext,
    );
    expect(result.allowed).toBe(true);
  });

  it('denies on the first policy that denies and stops evaluating further ones', async () => {
    let secondEvaluated = false;
    const result = await evaluatePolicies(
      [
        definePolicy({ id: 'a', evaluate: () => deny('no', 'BUSINESS_RULE_DENIED') }),
        definePolicy({
          id: 'b',
          evaluate: () => {
            secondEvaluated = true;
            return allow();
          },
        }),
      ],
      baseContext,
    );
    expect(result.allowed).toBe(false);
    expect(secondEvaluated).toBe(false);
  });

  it('Section 60 business policy example: denies reassigning an APPROVED application', async () => {
    const services = {
      applications: { get: (id: string) => Promise.resolve({ id, status: id === 'APP-1' ? 'APPROVED' : 'PENDING' }) },
    };
    const reassignmentStatusPolicy = definePolicy({
      id: 'applications.reassignment-status',
      appliesTo: 'applications.reassign',
      async evaluate({ input, services: injected }) {
        const app = (await (
          injected as typeof services
        ).applications.get((input as { applicationId: string }).applicationId)) as { status: string };
        if (app.status === 'APPROVED') return deny('Approved applications cannot be reassigned.', 'BUSINESS_RULE_DENIED');
        return allow();
      },
    });

    const denied = await evaluatePolicies([reassignmentStatusPolicy], {
      ...baseContext,
      input: { applicationId: 'APP-1' },
      services,
    });
    expect(denied.allowed).toBe(false);

    const allowed = await evaluatePolicies([reassignmentStatusPolicy], {
      ...baseContext,
      input: { applicationId: 'APP-2' },
      services,
    });
    expect(allowed.allowed).toBe(true);
  });

  it('fails closed when a policy throws instead of returning a result (Section 27)', async () => {
    const result = await evaluatePolicies(
      [
        definePolicy({
          id: 'broken',
          evaluate: () => {
            throw new Error('infrastructure failure');
          },
        }),
      ],
      baseContext,
    );
    expect(result.allowed).toBe(false);
    expect(!result.allowed && result.code).toBe('POLICY_DENIED');
  });

  it('an empty policy list allows (no applicable business rules)', async () => {
    expect((await evaluatePolicies([], baseContext)).allowed).toBe(true);
  });
});

describe('PolicyRegistry', () => {
  it('filters by appliesTo, and a policy with no appliesTo applies to every action', () => {
    const registry = createPolicyRegistry();
    registry.register(definePolicy({ id: 'specific', appliesTo: 'applications.delete', evaluate: () => allow() }));
    registry.register(definePolicy({ id: 'general', evaluate: () => allow() }));
    registry.register(
      definePolicy({ id: 'multi', appliesTo: ['applications.delete', 'applications.reassign'], evaluate: () => allow() }),
    );

    expect(registry.list('applications.delete').map((p) => p.id).sort()).toEqual(['general', 'multi', 'specific']);
    expect(registry.list('applications.view').map((p) => p.id)).toEqual(['general']);
  });

  it('unregister removes a policy', () => {
    const registry = createPolicyRegistry();
    registry.register(definePolicy({ id: 'a', evaluate: () => allow() }));
    registry.unregister('a');
    expect(registry.all()).toEqual([]);
  });
});
