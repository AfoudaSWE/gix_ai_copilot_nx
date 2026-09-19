# Phase 7 Implementation

## `@gixcopilot/security` (new package)

| File | Responsibility |
| --- | --- |
| `identity.ts` | `Identity`, `TenantIdentity`, `SessionIdentity`, `SecurityContext` |
| `authentication.ts` | `AuthenticationAdapter` interface; `createStaticAuthenticationAdapter` (deterministic, credential-free, for tests/demos) |
| `permissions.ts` | `resolvePermissions`/`hasPermission`/`hasAllPermissions`/`missingPermissions` (RBAC via an optional `RolePermissionMap`); `canApprove` (Section 27/33's "approving is itself authorized," via an `approvals.<level>` permission convention, `admin` satisfying any lower level) |
| `reason-codes.ts` | The stable `SecurityReasonCode` union (subset of `CopilotErrorCode`) |
| `policy.ts` | `Policy`/`PolicyContext`/`PolicyResult` (ABAC/business rules); `allow`/`deny`/`requireApproval`; `PolicyRegistry`; `evaluatePolicies` (fail-closed, first-deny-wins, can also escalate to an approval level) |
| `risk.ts` | `ActionRisk`/`ActionReversibility`/`ApprovalLevel` (re-exported from protocol); `createDefaultRiskPolicy` (configurable risk → approval-level mapping); `strongerApprovalLevel` |
| `action-request.ts` | `ActionMetadata` (trusted) / `ActionRequest` (trusted metadata + untrusted model-provided arguments kept as separate fields) |
| `action-decision.ts` | `ActionDecision` (`allow`/`deny`/`approval` discriminated union), `SecurityReason` |
| `pii.ts` | `SensitiveFieldSpec`, `defaultRedactor`, `redactFields`, `DataPolicy`, `createFieldRedactionDataPolicy` (recursive object/array redaction plus a `redactText` matcher for JSON-shaped text) |
| `action-preview.ts` | `ActionPreview`/`ChangePreview` (aliased from `@gixcopilot/protocol`'s wire-safe `ToolActionPreview`/`ToolChangePreview`, one source of truth) |
| `approval.ts` | `ApprovalRequest`/`ApprovalStatus`/`ApprovalDecisionRecord`; pure state-machine functions (`applyDecision`/`applyExpire`/`applyCancel`/`canTransition`/`isTerminal`/`isExpired`) |
| `approval-store.ts` | `ApprovalStore` interface + `createInMemoryApprovalStore` (create/get/approve/reject/expire/cancel/list, plus the run-pausing `awaitDecision`) |
| `audit.ts` | `AuditRecord`/`AuditSink`; `createInMemoryAuditSink`; `createSafeAuditSink` (fail-open/fail-closed wrapper) |
| `rate-limit.ts` | `RateLimiter` interface + `createFixedWindowRateLimiter` |
| `action-firewall.ts` | `ActionFirewall`/`createActionFirewall` — the pipeline orchestrator; also exposes `record()` for post-decision audit entries and an optional `onTelemetry` hook |
| `tool-discovery.ts` | `createPermissionAwareToolResolver` — wraps any `ToolResolver` to filter tools the caller's identity cannot use before they ever reach the model |
| `tool-middleware.ts` | `createActionFirewallMiddleware` — the `ToolRuntimeMiddleware` defense-in-depth layer around `ToolRuntime.execute()` |

## `@gixcopilot/protocol` (additive)

- `tool.ts`: `ToolActionRisk`/`ToolActionReversibility`/`ToolApprovalLevel`/`DataClassification`/
  `ToolSecurityManifest` (added to `ToolManifestEntry.security`); `ToolChangePreview`/
  `ToolActionPreview` (wire-safe dry-run preview shape); `ToolLifecycleEvent` gains four new
  `approval_*` phases.
- `events.ts`: four new `CopilotEvent` variants — `ApprovalRequestedEvent`/`ApprovedEvent`/
  `RejectedEvent`/`ExpiredEvent`.
- `errors.ts`: nine new `CopilotErrorCode`s (`AUTHENTICATION_REQUIRED`, `PERMISSION_DENIED`,
  `TENANT_MISMATCH`, `POLICY_DENIED`, `BUSINESS_RULE_DENIED`, `PII_POLICY_DENIED`,
  `APPROVAL_REQUIRED`, `APPROVAL_REJECTED`, `APPROVAL_EXPIRED`) plus matching `CopilotError`
  factories.
- `serialization.ts`: runtime schemas for all of the above, plus the pre-existing forward-
  compatibility fallback for a still-newer, unrecognized future event type.

## `@gixcopilot/core` (additive)

- `runtime.ts`'s `toCopilotToolEvent` gains the four `approval_*` phase → `approval.*` event
  mappings, reusing the exact `pendingToolEvents`/flush pipeline Phase 5 built — no new
  suspension mechanism was needed anywhere in core.

## `@gixcopilot/tools` (additive)

- `tool-definition.ts`/`define-tool.ts`: a new `security?: ToolSecurityManifest` field
  (sibling to `metadata`, not nested inside it) and an optional `dryRun?(input, context):
  Promise<ToolActionPreview>` capability.
- `tool-schema.ts`: `toToolManifestEntry` propagates `tool.security` into the wire manifest.

## `@gixcopilot/server` (the integration point)

- `tool-calling-executor.ts`: the two-pass dispatch described in
  [Architecture](Phase_7_Architecture.md); new options (`actionFirewall`, `approvals`,
  `securityContext`, `refreshSecurityContext`, `securityToolResolver`, `dataPolicy`,
  `approvalExpiresInMs`, `action` for direct invocation, `frontendDefinitions` for frontend
  output-schema validation).
- `app.ts`: `authenticationAdapter`/`actionFirewall`/`approvals`/`roleMap`/`dataPolicy`/
  `actionHistory` options on `createServer()`; per-request identity resolution;
  permission-aware backend/frontend tool filtering (unconditional — a no-op for any tool with
  no declared `security.requiredPermissions`); new routes `GET /approvals`,
  `GET /approvals/:approvalId`, `POST /approvals/:approvalId/approve`,
  `POST /approvals/:approvalId/reject`, `GET /actions` (tenant/identity-scoped visibility);
  `POST /runs/:runId/cancel` now requires the caller to be the run's own requester.
- `schemas.ts`: request-body schemas for the `security` manifest, the `action` field, and the
  approval endpoints.

## `@gixcopilot/client` / `@gixcopilot/react` (additive)

- `client.ts`/`transport.ts`/`sse-transport.ts`: `CopilotClient.decideApproval()`; a
  `getHeaders` option merged into every request (the credential-delivery mechanism a server's
  `AuthenticationAdapter` authenticates — never a place to put a role/identity claim directly).
- `types.ts`: `ApprovalState`; `ChatSnapshot.approvals`; `ChatActions.approveAction`/
  `rejectAction`; a new `'waiting_for_approval'` `ChatStatus` value; `CopilotProviderProps.
  getHeaders`.
- `chat-store.ts`: handles the four `approval.*` events (mirroring the existing `tool.*`
  handling); `invokeTool()` reroutes `useInvokeTool()` through a real `client.run({action})`
  call instead of purely local execution; cancellation marks any still-pending approvals
  `'cancelled'` locally too.
- `provider.tsx`: `useApprovals()`/`usePendingApprovals()`/`useApproval()` headless hooks,
  mirroring `useToolCalls()`'s own pattern.

## `@gixcopilot/ui` (additive)

- `approval.tsx` (new): `ApprovalCard` (Section 76-78's confirm/high-risk UI, accessible —
  `role="alertdialog"`, focus management, keyboard-operable, verified with `axe-core`),
  `ApprovalList`, `SecurityDenial` (Section 79).
- `components.tsx`: `CopilotChat` renders `<ApprovalList>` alongside the existing tool
  activity; a `tool.failed` whose error carries a firewall denial code renders
  `<SecurityDenial>` instead of the generic failure row.

## `examples/react-enterprise` (new)

A real, non-mocked demonstration: deterministic identity fixtures (viewer/officer/
supervisor/supervisor2/admin), five tools spanning every risk/approval tier, a tenant + status
ABAC policy, dry-run previews, PII redaction, and (when `OPENAI_API_KEY` is configured) a real
OpenAI chat panel using the identical firewall as the example's own direct-action buttons — no
fake/simulated model logic exists in the real execution path. See
`examples/react-enterprise/README.md`.
