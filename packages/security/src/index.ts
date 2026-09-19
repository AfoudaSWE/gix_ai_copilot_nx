export type {
  Identity,
  TenantIdentity,
  SessionIdentity,
  SecurityEnvironment,
  SecurityContext,
} from './identity.js';
export { ANONYMOUS_SECURITY_CONTEXT } from './identity.js';

export type { AuthenticationAdapter } from './authentication.js';
export { createStaticAuthenticationAdapter } from './authentication.js';

export type { RolePermissionMap } from './permissions.js';
export {
  resolvePermissions,
  hasPermission,
  hasAllPermissions,
  missingPermissions,
  canApprove,
} from './permissions.js';

export type { SecurityReasonCode } from './reason-codes.js';

export type { PolicyContext, PolicyResult, Policy, PolicyRegistry } from './policy.js';
export { allow, deny, requireApproval, definePolicy, createPolicyRegistry, evaluatePolicies } from './policy.js';

export type {
  ActionRisk,
  ActionReversibility,
  ApprovalLevel,
  RiskClassification,
  RiskPolicy,
  DefaultRiskPolicyOverrides,
} from './risk.js';
export { strongerApprovalLevel, createDefaultRiskPolicy } from './risk.js';

export type { ActionMetadata, ActionRequest } from './action-request.js';
export type { SecurityReason, ApprovalRequirement, ActionDecision } from './action-decision.js';

export type { DataClassification, SensitiveFieldSpec, DataPolicy } from './pii.js';
export { defaultRedactor, redactFields, createFieldRedactionDataPolicy } from './pii.js';

export type { ChangePreview, ActionPreview, ActionExplanation } from './action-preview.js';

export type { ApprovalStatus, ApprovalDecisionRecord, ApprovalRequest } from './approval.js';
export {
  requiredApproversFor,
  canTransition,
  isTerminal,
  isExpired,
  applyDecision,
  applyExpire,
  applyCancel,
} from './approval.js';

export type { CreateApprovalInput, ApprovalListFilter, ApprovalStore } from './approval-store.js';
export { createInMemoryApprovalStore, ApprovalConflictError } from './approval-store.js';

export type { AuditActor, AuditRecord, AuditSink, AuditFailureMode } from './audit.js';
export { createInMemoryAuditSink, createSafeAuditSink } from './audit.js';

export type { RateLimitRule, RateLimitDecision, RateLimiter } from './rate-limit.js';
export { createFixedWindowRateLimiter } from './rate-limit.js';

export type { CreateActionFirewallOptions, ActionFirewall, SecurityTelemetryEvent } from './action-firewall.js';
export { createActionFirewall } from './action-firewall.js';
export { createActionFirewallMiddleware } from './tool-middleware.js';
export type { FirewallMiddlewareOptions } from './tool-middleware.js';

export type { PermissionAwareResolverOptions } from './tool-discovery.js';
export { createPermissionAwareToolResolver } from './tool-discovery.js';
