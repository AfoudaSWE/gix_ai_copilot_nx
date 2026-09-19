/**
 * Stable reason codes (Section 61) - separate from the human-readable message on a
 * `SecurityReason`/`CopilotError`, so a client can branch on `code` without parsing text and
 * without ever seeing internal diagnostic detail that only belongs in the audit trail.
 */
export type SecurityReasonCode =
  | 'AUTHENTICATION_REQUIRED'
  | 'PERMISSION_DENIED'
  | 'TENANT_MISMATCH'
  | 'POLICY_DENIED'
  | 'APPROVAL_REQUIRED'
  | 'APPROVAL_REJECTED'
  | 'APPROVAL_EXPIRED'
  | 'PII_POLICY_DENIED'
  | 'RATE_LIMITED'
  | 'BUSINESS_RULE_DENIED';
