# Phase 7 Files

## Created

```text
packages/security/                                  (new package)
  package.json, tsconfig.json, project.json, vitest.config.ts
  src/identity.ts, authentication.ts, permissions.ts, reason-codes.ts
  src/policy.ts, risk.ts, action-request.ts, action-decision.ts
  src/pii.ts, action-preview.ts, approval.ts, approval-store.ts
  src/audit.ts, rate-limit.ts, action-firewall.ts, tool-discovery.ts
  src/tool-middleware.ts, index.ts
  src/*.spec.ts (permissions, policy, risk, approval, approval-store,
    pii, audit, rate-limit, action-firewall, tool-discovery, hardening)

packages/server/src/security-integration.spec.ts     (Phase 7 end-to-end HTTP tests)
packages/server/src/security-boundaries.spec.ts       (tenant/identity/staleness/idempotency tests)

packages/ui/src/approval.tsx                          (ApprovalCard, ApprovalList, SecurityDenial)
packages/ui/src/approval.spec.tsx                     (incl. axe-core accessibility check)

packages/react/src/approval-hooks.spec.tsx

examples/react-enterprise/                            (new example)
  package.json, project.json, tsconfig.json, vite.config.ts, vitest.config.ts
  index.html, src/main.tsx, src/backend.ts, src/server.ts, src/styles.css
  src/backend.spec.ts, README.md, .env.example

docs/adr/0012-action-firewall-and-hitl-architecture.md
docs/phases/phase-07/  (this directory - 10 files)
```

## Modified

```text
packages/protocol/src/tool.ts            security/preview/risk/reversibility/approval types;
                                          ToolManifestEntry.security; ToolLifecycleEvent phases
packages/protocol/src/events.ts          four new approval.* CopilotEvent variants
packages/protocol/src/errors.ts          nine new CopilotErrorCodes + factories
packages/protocol/src/serialization.ts   schemas for all of the above
packages/protocol/src/index.ts           new exports
packages/protocol/src/serialization.spec.ts   exhaustiveness switch extended

packages/core/src/runtime.ts             toCopilotToolEvent gains four approval_* mappings

packages/tools/src/tool-definition.ts    security?/dryRun? fields
packages/tools/src/define-tool.ts        security?/dryRun? options
packages/tools/src/tool-schema.ts        propagates tool.security into the wire manifest
packages/tools/src/tool-runtime.ts       two additional abort-signal checks (hardening)

packages/server/src/app.ts               auth/firewall/approval/roleMap/dataPolicy/
                                          actionHistory options; 5 new routes; cancel-
                                          authorization check
packages/server/src/tool-calling-executor.ts   the full Phase 7 dispatch pipeline (see
                                          Architecture.md)
packages/server/src/schemas.ts           security manifest, action field, approval schemas
packages/server/src/frontend-tool-bridge.ts    result.toolCallId cross-check (hardening)
packages/server/src/app.spec.ts          one pre-existing Phase 5 assertion updated (see
                                          Issues.md)
packages/server/package.json, project.json, tsconfig.json   @gixcopilot/security dependency

packages/client/src/transport.ts         decideApproval() on CopilotTransport
packages/client/src/sse-transport.ts     decideApproval(); getHeaders merged into every request
packages/client/src/client.ts            decideApproval(); getHeaders option
packages/client/src/client.spec.ts, sse-transport.spec.ts   updated/added tests

packages/react/src/types.ts              ApprovalState; ChatSnapshot.approvals;
                                          ChatActions.approveAction/rejectAction;
                                          'waiting_for_approval' status; getHeaders prop
packages/react/src/chat-store.ts         approval.* event handling; server-routed invokeTool()
packages/react/src/provider.tsx          useApprovals/usePendingApprovals/useApproval;
                                          getHeaders wired into the client
packages/react/src/internals.ts          serverActions flag
packages/react/src/generative-ui-hooks.tsx   useInvokeTool() routes through the server when
                                          serverActions is set
packages/react/src/index.ts              new exports
packages/react/src/*.spec.tsx            mock CopilotClient fixtures gain decideApproval;
                                          exhaustiveness switches extended; one new
                                          server-authorized-action test

packages/ui/src/components.tsx           renders ApprovalList; SecurityDenial for a firewall-
                                          coded tool.failed
packages/ui/src/labels.ts                eleven new label keys
packages/ui/src/styles.css               approval/denial UI styles
packages/ui/src/index.ts                 new exports
packages/ui/src/*.spec.tsx               unaffected suites re-verified

eslint.config.js                         scope:security module-boundary rule
tools/vitest.shared.ts                   @gixcopilot/security workspace alias
tsconfig.json                            packages/security project reference
examples/model-streaming/src/main.ts,
examples/protocol-demo/src/main.ts       exhaustiveness switches extended for approval.* events

docs/PROJECT_STATUS.md, docs/DECISIONS.md, docs/TECHNICAL_DEBT.md   Phase 7 entries
```

No file under any other existing example (`react-basic`, `react-custom-ui`, `react-context`,
`react-tools`, `react-generative-ui`) required a source change — their own test fixtures
needed a `decideApproval` mock added where they construct a fake `CopilotClient` by hand (see
the `packages/react/src/*.spec.tsx` note above); their application code is unmodified.
