import { describe, expect, it } from 'vitest';
import { createDefaultRiskPolicy, strongerApprovalLevel } from './risk.js';

describe('createDefaultRiskPolicy', () => {
  const policy = createDefaultRiskPolicy();

  it('defaults read-only to no approval', () => {
    expect(policy.resolveApprovalLevel({ risk: 'read-only' })).toBe('none');
  });

  it('defaults write to user confirmation', () => {
    expect(policy.resolveApprovalLevel({ risk: 'write' })).toBe('user-confirmation');
  });

  it('defaults destructive to a stronger approval', () => {
    expect(policy.resolveApprovalLevel({ risk: 'destructive' })).toBe('admin');
  });

  it('irreversible strengthens whatever the risk-based level would have been', () => {
    expect(
      policy.resolveApprovalLevel({ risk: 'write', reversibility: 'irreversible' }),
    ).toBe('admin');
  });

  it('an explicit tool-declared approval always wins over the computed default', () => {
    expect(policy.resolveApprovalLevel({ risk: 'read-only', explicitApproval: 'supervisor' })).toBe(
      'supervisor',
    );
  });

  it('fails closed to the strictest default for an unclassified action', () => {
    expect(policy.resolveApprovalLevel({})).toBe('admin');
  });

  it('respects configured overrides (Section 30 - do not hardcode business rules into core)', () => {
    const custom = createDefaultRiskPolicy({ write: 'supervisor', destructive: 'two-person' });
    expect(custom.resolveApprovalLevel({ risk: 'write' })).toBe('supervisor');
    expect(custom.resolveApprovalLevel({ risk: 'destructive' })).toBe('two-person');
  });
});

describe('strongerApprovalLevel', () => {
  it('picks the more restrictive of two levels', () => {
    expect(strongerApprovalLevel('none', 'admin')).toBe('admin');
    expect(strongerApprovalLevel('two-person', 'user-confirmation')).toBe('two-person');
    expect(strongerApprovalLevel('supervisor', 'supervisor')).toBe('supervisor');
  });
});
