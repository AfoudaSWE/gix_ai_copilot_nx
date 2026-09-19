import type { ToolActionRisk, ToolActionReversibility, ToolApprovalLevel } from '@gixcopilot/protocol';

export type { ToolActionRisk as ActionRisk, ToolActionReversibility as ActionReversibility, ToolApprovalLevel as ApprovalLevel } from '@gixcopilot/protocol';

/** Fixed order, least to most restrictive - used only to pick the *stronger* of two levels
 * when several inputs disagree (e.g. an explicit override vs. a computed default). */
const APPROVAL_LEVEL_ORDER: readonly ToolApprovalLevel[] = [
  'none',
  'user-confirmation',
  'supervisor',
  'admin',
  'two-person',
];

export function strongerApprovalLevel(a: ToolApprovalLevel, b: ToolApprovalLevel): ToolApprovalLevel {
  return APPROVAL_LEVEL_ORDER.indexOf(a) >= APPROVAL_LEVEL_ORDER.indexOf(b) ? a : b;
}

export interface RiskClassification {
  readonly risk?: ToolActionRisk;
  readonly reversibility?: ToolActionReversibility;
  /** An explicit, tool-declared override - always wins over the computed default (Section 30's
   * "make policy configurable", not hardcoded into core). */
  readonly explicitApproval?: ToolApprovalLevel;
}

export interface RiskPolicy {
  resolveApprovalLevel(classification: RiskClassification): ToolApprovalLevel;
}

export interface DefaultRiskPolicyOverrides {
  readonly readOnly?: ToolApprovalLevel;
  readonly write?: ToolApprovalLevel;
  readonly destructive?: ToolApprovalLevel;
  readonly irreversible?: ToolApprovalLevel;
}

/**
 * Safe-by-default risk -> approval mapping (Section 30). Applications configure their own
 * business rules via `overrides` rather than this package hardcoding them (Section 30, 128's
 * explicit "do not hardcode enterprise business rules into core"). An unclassified action
 * (no `risk` declared at all) defaults to the strongest configured level, never to `none` -
 * "we don't know" must never mean "allow" for a consequential action (Section 27).
 */
export function createDefaultRiskPolicy(overrides: DefaultRiskPolicyOverrides = {}): RiskPolicy {
  const readOnly = overrides.readOnly ?? 'none';
  const write = overrides.write ?? 'user-confirmation';
  const destructive = overrides.destructive ?? 'admin';
  const irreversible = overrides.irreversible ?? 'admin';

  return {
    resolveApprovalLevel({ risk, reversibility, explicitApproval }) {
      if (explicitApproval !== undefined) return explicitApproval;

      let level: ToolApprovalLevel;
      switch (risk) {
        case 'read-only':
          level = readOnly;
          break;
        case 'write':
          level = write;
          break;
        case 'destructive':
          level = destructive;
          break;
        case undefined:
          level = destructive; // Unclassified - fail closed to the strictest ordinary default.
          break;
      }
      if (reversibility === 'irreversible' || reversibility === 'compensatable') {
        level = strongerApprovalLevel(level, irreversible);
      }
      return level;
    },
  };
}
