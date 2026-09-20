# Phase 8 completion report

```
AI COPILOT SDK
PHASE 08 — OPENAPI + MCP + EXTERNAL INTEGRATIONS


STATUS

COMPLETE


PREVIOUS PHASE REGRESSION

Phase 1:
PASS

Phase 2:
PASS

Phase 3:
PASS

Phase 4:
PASS

Phase 5:
PASS

Phase 6:
PASS

Phase 7:
PASS


OPENAPI

Loader:
PASS

Validation:
PASS

Operation Discovery:
PASS

Schema Conversion:
PASS

Automatic Tool Generation:
PASS

Tool Naming:
PASS

Namespaces:
PASS

Conflict Detection:
PASS

Exposure Policies:
PASS

Operation Overrides:
PASS

Security Metadata:
PASS

Credential Provider:
PASS

HTTP Executor:
PASS

Cancellation:
PASS

Timeout:
PASS

Error Normalization:
PASS

Response Filtering:
PASS

Refresh:
PASS

Inspection:
PASS


OPENAPI GENERATION RESULTS

Integration:
examples/openapi (a local "VAS-like" master-data API against `examples/openapi/src/test-api-server.ts`)

Operations Discovered:
5 (getApplication, updateApplication, deleteApplication, searchApplications, assignApplication)

Generated:
4 (getApplication, updateApplication, searchApplications, assignApplication — via an explicit `include` list)

Skipped:
0

Denied:
1 (deleteApplication — not in the explicit `include` list; DELETE is also deny-by-default under the method policy)

Unsupported:
0

Warnings:
0 (see `examples/openapi/src/benchmark.ts`'s synthetic 1,000-operation run for the unsupported/denied-at-scale case: 20 selected of 1,000 candidates, 980 denied, 0 unsupported)


MCP

Client:
PASS

Connection:
PASS

Lifecycle:
PASS

Tool Discovery:
PASS

Schema Mapping:
PASS

Canonical Tool Generation:
PASS

Namespaces:
PASS

Exposure Policies:
PASS

Permissions:
PASS

Action Firewall:
PASS

Approval:
PASS

Execution:
PASS

Cancellation:
PASS

Timeout:
PASS

Error Normalization:
PASS

Resource Discovery:
PASS (capability-gated; returns the first page only — a documented Phase 8 foundation limit, not RAG)

Prompt Discovery:
PASS (capability-gated; returns the first page only — same documented limit)


UNIFIED TOOL ARCHITECTURE

Native Tools:
PASS

Frontend Tools:
PASS

Backend Tools:
PASS

OpenAPI Tools:
PASS

MCP Tools:
PASS

Single Tool Registry:
PASS

Single Action Firewall:
PASS

Single Approval System:
PASS

Single Audit Path:
PASS


SECURITY

Credentials Server-Side:
PASS

Credential Redaction:
PASS

SSRF Protection:
PASS

Permission Filtering:
PASS

Execution Reauthorization:
PASS

PII/Data Policy:
PASS

Destructive Action Governance:
PASS

Tenant Isolation:
PASS


REAL MODEL VALIDATION

OpenAI → OpenAPI Tool:
PASS

OpenAI → Approval → OpenAPI:
PASS

OpenAI → MCP Tool:
PASS


TEST RESULTS

Lint:
PASS

Typecheck:
PASS

Unit Tests:
PASS

OpenAPI Tests:
PASS

MCP Tests:
PASS

Security Tests:
PASS

Integration Tests:
PASS

Build:
PASS


PERFORMANCE

OpenAPI Parse Time:
25.87 ms (synthetic 1,000-operation JSON document, via `createOpenAPILoader`)

Tool Generation Time:
19.78 ms (1,000 candidates discovered, 20 explicitly selected/generated); 2.19 ms for the real 5-operation `examples/openapi` spec

Generated Tool Count:
20 of 1,000 candidates in the synthetic benchmark; 4 of 5 in `examples/openapi`; 3 of 3 explicitly-selected tools in `examples/mcp`

Model-Visible Tool Count:
20 (synthetic benchmark's serialized manifest: 5,571 bytes for 20 tools)

MCP Discovery Time:
9.95 ms (after a 809.29 ms one-time stdio process startup/connection; combined registration 820.23 ms)


DEPENDENCIES ADDED

- yaml@2.9.1 (ISC) — server-side YAML parsing for `@gixcopilot/openapi`'s loader.
- @modelcontextprotocol/sdk@1.30.0 (MIT) — the official MCP client, confined to `packages/mcp/src/client.ts`.
- zod@4.6.5 — already a workspace dependency; reused, not a second validation runtime.

No new dependency was added to `@gixcopilot/protocol`, `@gixcopilot/core`, `@gixcopilot/client`,
`@gixcopilot/security`, `@gixcopilot/server`, or any provider package.


PROTOCOL CHANGES

None. `ToolSource`'s `'openapi'`/`'mcp'` values and `ToolMetadata.custom` were already reserved
in Phase 5; no `CopilotEvent`, error code, or wire shape changed.


PUBLIC APIS

- `@gixcopilot/openapi`: `registerOpenAPI`, `inspectOpenAPI`, `generateOpenAPITools`,
  `createOpenAPILoader`, `validateOpenAPIDocument`, `resolveLocalRefs`, `discoverOperations`,
  `deriveToolName`/`deriveFallbackName`/`operationKey`/`detectNamingConflicts`,
  `resolveOperationExposure`, `buildSecurityMetadata`, `buildOperationInputPlan`,
  `createFetchHttpExecutor`, `normalizeHttpError`/`normalizeExecutionError`,
  `shouldRetry`/`retryDelayMs`/`withRetry`; types `OpenAPIIntegration`, `OpenAPISource`,
  `OpenAPIMethodPolicy`, `OpenAPIOperationOverride`, `OpenAPIGenerationReport`, and more — see
  [Phase 8 API](Phase_8_API.md).
- `@gixcopilot/mcp`: `registerMCP`, `inspectMCP`, `generateMcpTools`, `createMcpClient`,
  `deriveMcpToolName`, `buildMcpInputSchema`, `resolveMcpToolExposure`,
  `buildMcpSecurityMetadata`, `normalizeMcpError`/`normalizeMcpToolFailure`; types
  `MCPIntegration`, `McpClient`, `McpTransportConfig`, `McpToolOverride`,
  `McpGenerationReport`, and more — see [Phase 8 API](Phase_8_API.md).
- `@gixcopilot/integrations`: `createIntegrationRegistry`; types `IntegrationRecord`,
  `IntegrationSummary`, `IntegrationType`, `IntegrationHealth`.
- `@gixcopilot/tools` (additive): `jsonSchemaToZod`, `toToolNameSegment`,
  `CredentialProvider`/`staticCredentialProvider`/`noCredentialsProvider`/
  `credentialsToHeaders`/`redactSensitiveHeaders`/`redactCredentialValues`,
  `toolSourceAuditMetadata`, `measureIntegration`/`IntegrationTelemetryEvent`.


ARCHITECTURE DECISIONS

See [ADR 0013](../../adr/0013-openapi-mcp-integration-architecture.md) and
[Phase 8 Decisions](Phase_8_Decisions.md) for the full record. Headline decisions: generation
is registry-agnostic and `registerOpenAPI`/`registerMCP` never silently overwrite a name
collision; exposure policy is a coarse allow/approval/deny (OpenAPI) or deny-by-default (MCP)
gate, deliberately decoupled from `ToolApprovalLevel` computation, which stays owned by the
application's own risk policy; every generated tool falls back to an integration-scoped
permission so none is ever permission-less; a server with no configured Action Firewall now
refuses to execute any OpenAPI/MCP-sourced tool at all rather than allowing it through
unguarded; the official MCP SDK is wrapped behind project-owned types in exactly one file.


FILES CREATED

74 new files across `packages/openapi/`, `packages/mcp/`, `packages/integrations/`,
`examples/openapi/`, `examples/mcp/`, plus `packages/tools/src/{credential-provider,
json-schema-to-zod,tool-name-segment,integration-telemetry}.{ts,spec.ts}`,
`docs/adr/0013-*.md`, and all 10 `docs/phases/phase-08/Phase_8_*.md` files — see
[Phase 8 Files](Phase_8_Files.md) for the complete, exact list.


FILES MODIFIED

`docs/CHANGELOG_PHASES.md`, `docs/DECISIONS.md`, `docs/PROJECT_STATUS.md`,
`docs/TECHNICAL_DEBT.md`, `docs/architecture/overview.md`, `eslint.config.js`,
`packages/generative-ui/src/{generative-ui-tool,state-patch-tool}.ts` (import redirect to the
relocated `toToolNameSegment`), `packages/security/src/{action-firewall,action-request,
tool-middleware}.ts` (additive `sourceMetadata` audit field), `packages/server/src/
tool-calling-executor.ts` (the external-tool-requires-a-firewall gate; duration/external-status
audit fields), `packages/tools/src/{index,tool-metadata,tool-runtime}.ts` (new exports; a fix
so `ToolRuntime` preserves an already-normalized `CopilotError` code instead of flattening it
to `TOOL_EXECUTION_ERROR`), `pnpm-lock.yaml`, `tools/vitest.shared.ts`, `tsconfig.json`.
`packages/generative-ui/src/tool-name-segment.{ts,spec.ts}` were deleted (relocated to
`@gixcopilot/tools`). See [Phase 8 Files](Phase_8_Files.md) for the complete list.


COMMITS

None. No commit was requested or created this phase.


ISSUES

Real issues found and fixed during implementation (all fixed within this phase, none carried
forward as debt) — see [Phase 8 Issues](Phase_8_Issues.md) for the complete, itemized list
with resolutions. Highlights: an initial OpenAPI fallback-naming rule that would have collided
`GET`/`POST` on the same nested collection path onto one generated name (caught by a test,
fixed); `@gixcopilot/mcp`'s `listResources()`/`listPrompts()` originally always issuing a list
request that fails against a server advertising no such capability (fixed via
`getServerCapabilities()` gating); the examples initially authenticated callers but never
configured an Action Firewall, so generated tools executed without real authorization — closed
by making external-tool execution fail closed without a firewall, and by wiring a real
firewall/approval store/audit sink into both examples; request headers could have overridden a
credential header of the same name — fixed with case-insensitive credential precedence; the
HTTP executor did not refuse redirects or bound response size; `ToolRuntime` was flattening an
already-normalized `CopilotError` (e.g. `RATE_LIMITED`) into a generic `TOOL_EXECUTION_ERROR`.


TECHNICAL DEBT

No new debt category was introduced — see the Phase 8 entry in `docs/TECHNICAL_DEBT.md` and
[Phase 8 Issues](Phase_8_Issues.md)'s "Supported limits" section for the honest, explicit
boundary (structural OpenAPI validation rather than a full spec linter; resource/prompt
discovery returns the first page only; refresh/registry state is process-local, the same
documented limitation every prior phase's in-memory stores already carry). None of this is
deferred work masquerading as debt — it is explicitly scoped, documented Phase 8 boundary.


DOCUMENTATION

Phase_8_Docs:
PASS

Phase_8_Architecture:
PASS

Phase_8_Implementation:
PASS

Phase_8_Status:
PASS

Phase_8_Testing:
PASS

Phase_8_Decisions:
PASS

Phase_8_API:
PASS

Phase_8_Files:
PASS

Phase_8_Issues:
PASS

Phase_8_Handoff:
PASS
```

## Notes on this report

This report was compiled after independently re-verifying the claims made during
implementation, in this same session:

- A fresh, no-cache `nx run-many` for `lint`/`typecheck`/`test`/`build` was re-run directly by
  the reporting session (not merely re-stated from an earlier pass): 27/27 projects lint clean,
  27/27 typecheck clean, 26/26 projects build clean, 26/26 projects test clean — **750 tests
  passed, 4 skipped** (all four skips are the optional real-OpenAI smoke suites, correctly
  gated on `OPENAI_API_KEY`/`RUN_OPENAI_SMOKE=1`), **zero failures**, across 105 test files.
- All three real-OpenAI flows Section 166 asks to manually verify were independently re-run
  with `RUN_OPENAI_SMOKE=1` and a real `OPENAI_API_KEY` (supplied via `--env-file`, never
  echoed or committed) and confirmed to pass for real, with genuine model tool selection and a
  genuine local HTTP/MCP round trip — not prompt-matched or simulated.
- `packages/openapi/src/governance.spec.ts`'s equivalent in `examples/openapi/src/
  governance.spec.ts` and `packages/openapi/src/security-hardening.spec.ts` were each run in
  isolation and confirmed passing, in addition to the full workspace run.

See [Phase 8 Testing](Phase_8_Testing.md) for exact commands, durations, and the full evidence
table.
