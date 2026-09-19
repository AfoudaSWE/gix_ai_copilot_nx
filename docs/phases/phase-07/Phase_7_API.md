# Phase 7 API

Only APIs actually implemented and exported are listed (Section 125). Full JSDoc lives at each
symbol's definition; this is an index, not a duplicate of the source.

## `@gixcopilot/security`

### Identity & authentication

```ts
interface Identity { subject: string; roles: readonly string[]; permissions: readonly string[]; attributes?: Readonly<Record<string, unknown>>; }
interface TenantIdentity { tenantId: string; }
interface SessionIdentity { sessionId: string; issuedAt?: string; }
interface SecurityContext { identity?: Identity; tenant?: TenantIdentity; session?: SessionIdentity; environment?: SecurityEnvironment; metadata?: Readonly<Record<string, unknown>>; }
const ANONYMOUS_SECURITY_CONTEXT: SecurityContext;

interface AuthenticationAdapter { authenticate(requestContext: unknown): Promise<Identity | null>; }
function createStaticAuthenticationAdapter(identitiesByToken: Readonly<Record<string, Identity>>): AuthenticationAdapter;
```

### Permissions (RBAC)

```ts
type RolePermissionMap = Readonly<Record<string, readonly string[]>>;
function resolvePermissions(identity: Identity, roleMap?: RolePermissionMap): readonly string[];
function hasPermission(identity: Identity | undefined, permission: string, roleMap?: RolePermissionMap): boolean;
function hasAllPermissions(identity: Identity | undefined, required: readonly string[], roleMap?: RolePermissionMap): boolean;
function missingPermissions(identity: Identity | undefined, required: readonly string[], roleMap?: RolePermissionMap): readonly string[];
function canApprove(identity: Identity | undefined, level: ToolApprovalLevel, roleMap?: RolePermissionMap): boolean;
```

### Policy (ABAC / business rules)

```ts
interface PolicyContext { identity?: Identity; tenant?: TenantIdentity; action: string; input: unknown; resource?: unknown; services?: Readonly<Record<string, unknown>>; }
type PolicyResult = { allowed: true; approval?: ToolApprovalLevel } | { allowed: false; reason: string; code: SecurityReasonCode };
function allow(): PolicyResult;
function requireApproval(level: ToolApprovalLevel): PolicyResult;
function deny(reason: string, code?: SecurityReasonCode): PolicyResult;
interface Policy { id: string; appliesTo?: string | readonly string[]; evaluate(context: PolicyContext): Promise<PolicyResult> | PolicyResult; }
function definePolicy(policy: Policy): Policy;
interface PolicyRegistry { register(policy: Policy): void; unregister(id: string): void; list(action: string): readonly Policy[]; all(): readonly Policy[]; }
function createPolicyRegistry(initial?: readonly Policy[]): PolicyRegistry;
function evaluatePolicies(policies: readonly Policy[], context: PolicyContext, onEvaluated?: (policyId: string, durationMs: number) => void): Promise<PolicyResult>;
```

### Risk & approval level

```ts
type ActionRisk = 'read-only' | 'write' | 'destructive';           // from @gixcopilot/protocol
type ActionReversibility = 'reversible' | 'compensatable' | 'irreversible'; // from @gixcopilot/protocol
type ApprovalLevel = 'none' | 'user-confirmation' | 'supervisor' | 'admin' | 'two-person'; // from @gixcopilot/protocol
function strongerApprovalLevel(a: ApprovalLevel, b: ApprovalLevel): ApprovalLevel;
interface RiskPolicy { resolveApprovalLevel(classification: RiskClassification): ApprovalLevel; }
function createDefaultRiskPolicy(overrides?: DefaultRiskPolicyOverrides): RiskPolicy;
```

### Action request / decision

```ts
interface ActionMetadata { toolName: string; source: 'frontend' | 'backend'; risk?: ActionRisk; reversibility?: ActionReversibility; requiredPermissions?: readonly string[]; approval?: ApprovalLevel; dataClassification?: DataClassification; }
interface ActionRequest { revalidation?: boolean; actionId: string; runId: string; toolCallId?: string; action: string; arguments: unknown; metadata: ActionMetadata; }
interface SecurityReason { code: SecurityReasonCode; message: string; }
interface ApprovalRequirement { level: ApprovalLevel; reason?: string; }
type ActionDecision = { decision: 'allow' } | { decision: 'deny'; reason: SecurityReason } | { decision: 'approval'; approval: ApprovalRequirement };
```

### PII / data policy

```ts
type DataClassification = 'public' | 'internal' | 'confidential' | 'pii' | 'secret';
interface SensitiveFieldSpec { field: string; classification: DataClassification; redact?: (value: unknown) => unknown; }
function defaultRedactor(value: unknown): unknown;
function redactFields<T extends Record<string, unknown>>(data: T, specs: readonly SensitiveFieldSpec[]): T;
interface DataPolicy { redact(data: unknown): unknown; redactText?(text: string): string; }
function createFieldRedactionDataPolicy(specs: readonly SensitiveFieldSpec[]): DataPolicy;
```

### Dry-run / preview

```ts
type ChangePreview = ToolChangePreview;   // aliased from @gixcopilot/protocol
type ActionPreview = ToolActionPreview;   // aliased from @gixcopilot/protocol
interface ActionExplanation { action: string; summary: string; changes?: readonly ChangePreview[]; impact?: string; risk?: { risk?: ActionRisk; reversibility?: ActionReversibility }; }
```

### Approval / HITL

```ts
type ApprovalStatus = 'pending' | 'partially_approved' | 'approved' | 'rejected' | 'expired' | 'cancelled';
interface ApprovalDecisionRecord { approverSubject: string; decision: 'approve' | 'reject'; at: string; comment?: string; }
interface ApprovalRequest { approvalId: string; actionId: string; runId: string; toolCallId?: string; requestedBy?: string; approvalLevel: ApprovalLevel; status: ApprovalStatus; createdAt: string; expiresAt?: string; summary: string; risk?: ActionRisk; reversibility?: ActionReversibility; requiredPermissions?: readonly string[]; requiredApprovers: number; approvals: readonly ApprovalDecisionRecord[]; preview?: ActionPreview; revision?: number; }
function requiredApproversFor(level: ApprovalLevel): number;
function canTransition(from: ApprovalStatus, to: ApprovalStatus): boolean;
function isTerminal(status: ApprovalStatus): boolean;
function isExpired(request: ApprovalRequest, now: Date): boolean;
function applyDecision(request: ApprovalRequest, approverSubject: string, decision: 'approve' | 'reject', now: Date, comment?: string): ApprovalRequest;
function applyExpire(request: ApprovalRequest): ApprovalRequest;
function applyCancel(request: ApprovalRequest): ApprovalRequest;

interface ApprovalStore {
  create(input: CreateApprovalInput, now?: Date): Promise<ApprovalRequest>;   // idempotent by approvalId; rejects if the id already belongs to a different action
  get(approvalId: string): Promise<ApprovalRequest | undefined>;
  // `revision`, when supplied, must match the request's current revision or the call
  // rejects with ApprovalConflictError - optimistic concurrency for a duplicate/racing decision.
  approve(approvalId: string, approverSubject: string, comment?: string, now?: Date, revision?: number): Promise<ApprovalRequest>;
  reject(approvalId: string, approverSubject: string, comment?: string, now?: Date, revision?: number): Promise<ApprovalRequest>;
  expire(approvalId: string, now?: Date): Promise<ApprovalRequest>;
  cancel(approvalId: string): Promise<ApprovalRequest>;
  list(filter?: ApprovalListFilter): Promise<readonly ApprovalRequest[]>;
  awaitDecision(approvalId: string, options?: { signal?: AbortSignal }): Promise<ApprovalRequest>;
}
function createInMemoryApprovalStore(): ApprovalStore;
class ApprovalConflictError extends Error {}   // thrown on a stale `revision` argument
```

### Audit

```ts
interface AuditActor { kind: 'user' | 'system' | 'model'; subject?: string; }
interface AuditRecord { id: string; timestamp: string; tenantId?: string; actor: AuditActor; action: string; tool?: string; runId?: string; toolCallId?: string; decision: string; approval?: { approvalId: string; status: ApprovalStatus }; resultStatus?: 'success' | 'error' | 'denied' | 'pending'; metadata?: Readonly<Record<string, unknown>>; }
interface AuditSink { write(record: AuditRecord): Promise<void>; }
function createInMemoryAuditSink(): AuditSink & { list(): readonly AuditRecord[] };
type AuditFailureMode = 'fail-open' | 'fail-closed';
function createSafeAuditSink(sink: AuditSink, mode?: AuditFailureMode, onError?: (error: unknown, record: AuditRecord) => void): AuditSink;
```

### Rate limiting

```ts
interface RateLimitRule { limit: number; windowMs: number; }
interface RateLimitDecision { allowed: boolean; remaining: number; }
interface RateLimiter { consume(key: string, cost?: number, now?: number): RateLimitDecision; }
function createFixedWindowRateLimiter(rules: Readonly<Record<string, RateLimitRule>>, defaultRule?: RateLimitRule): RateLimiter;
```

### The firewall itself

```ts
interface SecurityTelemetryEvent { stage: 'firewall' | 'policy' | 'audit'; action: string; durationMs: number; runId?: string; policyId?: string; }
interface CreateActionFirewallOptions { onTelemetry?: (event: SecurityTelemetryEvent) => void; policies?: PolicyRegistry; audit?: AuditSink; roleMap?: RolePermissionMap; riskPolicy?: RiskPolicy; rateLimiter?: RateLimiter; services?: Readonly<Record<string, unknown>>; now?: () => Date; }
interface ActionFirewall {
  evaluate(request: ActionRequest, context: SecurityContext): Promise<ActionDecision>;
  record?(record: AuditRecord): Promise<void>;
}
function createActionFirewall(options?: CreateActionFirewallOptions): ActionFirewall;

interface FirewallMiddlewareOptions { firewall: ActionFirewall; resolver: ToolResolver; getContext: () => SecurityContext | Promise<SecurityContext>; hasApproval?: (toolCallId: string, level: ApprovalLevel) => boolean; revalidation?: boolean; }
function createActionFirewallMiddleware(options: FirewallMiddlewareOptions): ToolRuntimeMiddleware;

interface PermissionAwareResolverOptions { roleMap?: RolePermissionMap; }
function createPermissionAwareToolResolver(resolver: ToolResolver, identity: Identity | undefined, options?: PermissionAwareResolverOptions): ToolResolver;
```

## `@gixcopilot/protocol` (additive)

```ts
type ToolActionRisk = 'read-only' | 'write' | 'destructive';
type ToolActionReversibility = 'reversible' | 'compensatable' | 'irreversible';
type ToolApprovalLevel = 'none' | 'user-confirmation' | 'supervisor' | 'admin' | 'two-person';
type DataClassification = 'public' | 'internal' | 'confidential' | 'pii' | 'secret';
interface ToolSecurityManifest { requiredPermissions?: readonly string[]; risk?: ToolActionRisk; reversibility?: ToolActionReversibility; approval?: ToolApprovalLevel; dataClassification?: DataClassification; }
interface ToolChangePreview { field: string; before?: unknown; after?: unknown; }
interface ToolActionPreview { summary: string; changes?: readonly ToolChangePreview[]; warnings?: readonly string[]; }
// ToolManifestEntry gains: security?: ToolSecurityManifest

interface ApprovalRequestedEvent extends CopilotEventBase { type: 'approval.requested'; approvalId: string; toolCallId: ToolCallId; action: string; approvalLevel: ToolApprovalLevel; summary: string; risk?: ToolActionRisk; reversibility?: ToolActionReversibility; expiresAt?: string; preview?: ToolActionPreview; }
interface ApprovalApprovedEvent extends CopilotEventBase { type: 'approval.approved'; approvalId: string; toolCallId: ToolCallId; decidedBy?: string; }
interface ApprovalRejectedEvent extends CopilotEventBase { type: 'approval.rejected'; approvalId: string; toolCallId: ToolCallId; decidedBy?: string; reason?: string; }
interface ApprovalExpiredEvent extends CopilotEventBase { type: 'approval.expired'; approvalId: string; toolCallId: ToolCallId; }

type CopilotErrorCode += 'AUTHENTICATION_REQUIRED' | 'PERMISSION_DENIED' | 'TENANT_MISMATCH' | 'POLICY_DENIED' | 'BUSINESS_RULE_DENIED' | 'PII_POLICY_DENIED' | 'APPROVAL_REQUIRED' | 'APPROVAL_REJECTED' | 'APPROVAL_EXPIRED';
// CopilotError gains matching static factories: .authenticationRequired() .permissionDenied() .tenantMismatch() .policyDenied() .businessRuleDenied() .piiPolicyDenied() .approvalRequired() .approvalRejected() .approvalExpired()
```

## `@gixcopilot/tools` (additive)

```ts
// ToolDefinition / DefineToolOptions gain:
security?: ToolSecurityManifest;
dryRun?(input: TInput, context: ToolExecutionContext): Promise<ToolActionPreview>;
```

## `@gixcopilot/server` (additive on `CreateServerOptions`)

```ts
authenticationAdapter?: AuthenticationAdapter;
actionFirewall?: ActionFirewall;
approvals?: ApprovalStore;
roleMap?: RolePermissionMap;
approvalExpiresInMs?: number;
dataPolicy?: DataPolicy;
actionHistory?: { list(): readonly AuditRecord[] };
frontendToolRegistry?: ToolRegistry;   // real Zod-validated frontend tool definitions, for output validation
```

New routes: `GET /approvals`, `GET /approvals/:approvalId`, `POST /approvals/:approvalId/approve`,
`POST /approvals/:approvalId/reject`, `GET /actions`. `POST /runs` request body gains an
optional `action: { name: string; arguments: Record<string, unknown> }` field for direct
(non-model) invocation.

## `@gixcopilot/client`

```ts
interface CopilotClientOptions { /* ...existing... */ getHeaders?: () => Record<string, string> | Promise<Record<string, string>>; }
interface CopilotClient { /* ...existing... */ decideApproval(approvalId: string, decision: 'approve' | 'reject', comment?: string): Promise<void>; }
```

## `@gixcopilot/react`

```ts
function useApprovals(): readonly ApprovalState[];
function usePendingApprovals(): readonly ApprovalState[];
function useApproval(approvalId: string): ApprovalState | undefined;
// useCopilot()/useCopilotChat() actions gain: approveAction(approvalId, comment?) rejectAction(approvalId, comment?)
// CopilotProviderProps gains: getHeaders?: () => Record<string, string> | Promise<Record<string, string>>
```

```ts
interface ApprovalState { approvalId: string; toolCallId: ToolCallId; action: string; approvalLevel: ToolApprovalLevel; summary: string; status: 'pending' | 'approved' | 'rejected' | 'expired' | 'cancelled'; risk?: ToolActionRisk; reversibility?: ToolActionReversibility; expiresAt?: string; preview?: ToolActionPreview; decidedBy?: string; }
```

## `@gixcopilot/ui`

```ts
function ApprovalCard(props: { approval: ApprovalState; onApprove: (id: string, comment?: string) => void | Promise<void>; onReject: (id: string, comment?: string) => void | Promise<void>; labels?: CopilotLabels }): ReactElement;
function ApprovalList(props: { approvals: readonly ApprovalState[]; onApprove: ...; onReject: ...; labels?: CopilotLabels }): ReactElement | null;
function SecurityDenial(props: { message: string; labels?: CopilotLabels }): ReactElement;
```

`CopilotLabels` gains: `approvalTitle`, `approvalPending`, `approvalApproved`,
`approvalRejected`, `approvalExpired`, `approvalApprove`, `approvalReject`,
`approvalCommentPlaceholder`, `approvalRequires`, `approvalPreviewTitle`, `denialTitle`.
