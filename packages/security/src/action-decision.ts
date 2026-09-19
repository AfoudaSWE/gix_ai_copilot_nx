import type { ToolApprovalLevel } from '@gixcopilot/protocol';
import type { SecurityReasonCode } from './reason-codes.js';

export interface SecurityReason {
  readonly code: SecurityReasonCode;
  readonly message: string;
}

export interface ApprovalRequirement {
  readonly level: ToolApprovalLevel;
  readonly reason?: string;
}

/**
 * The firewall's decision for one action (Section 25). A discriminated union rather than a
 * boolean so a caller must handle every outcome explicitly - especially `'approval'`, which
 * is neither "yes" nor "no" and must never be treated as either by a caller that only checks
 * truthiness.
 */
export type ActionDecision =
  | { readonly decision: 'allow' }
  | { readonly decision: 'deny'; readonly reason: SecurityReason }
  | { readonly decision: 'approval'; readonly approval: ApprovalRequirement };
