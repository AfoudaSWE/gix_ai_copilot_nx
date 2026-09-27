# Production security

Trust boundaries: browser → authentication → server → runtime → model → tool request →
**Action Firewall** → tool → external systems. The model is untrusted at every step.

**Checklist**
- `AICOPILOT_REQUIRE_AUTH=true` (enforced by config in staging and production). Use a real
  authentication adapter (OIDC/JWKS gateway, or the reference HS256 verifier with a strong
  secret and issuer and audience checks). Tenant, project and environment come only from
  verified claims.
- Every tool declares its risk. Write and destructive tools require approval. Durable
  approvals come from `createPostgresApprovalStore`.
- Durable audit (`PostgresAuditSink`, append-only) and a retention period that matches your
  obligations.
- Telemetry mode `redacted` (or `metadata-only`); `development-verbose` is rejected in
  production.
- DevTools off (rejected in production). `/metrics` token-protected and without tenant
  labels.
- Secrets from a secret manager (mounted files or a custom `SecretProvider`). Platform
  secrets use `AICOPILOT_SECRET_KEY` (AES-256-GCM, rotate via key versions).
- The platform behind TLS and your identity-aware proxy. Grant least-privilege roles, keep
  conversation content access at `none` unless policy requires otherwise, and review audit.
- Run `aicopilot doctor`, `tools/secret-scan.mjs` and `pnpm audit` in CI.

**Guarantees the code enforces** (tested): model output never authorizes anything; only
registered tools act; OpenAPI and MCP tools pass the firewall; generative UI renders only
registered components; approvals are recorded decisions bound to tenant and requester; RAG
filters before text reaches the model; memory is owner- and tenant-checked; tenants cannot
read each other's data; fallback never repeats a side effect; the platform cannot weaken
code-declared security; DevTools and the platform are read-only or authorized.

**Not provided**: an identity provider, WAF/DDoS protection, network policy, database
encryption at rest (use your cloud's), or vulnerability-free dependencies (`pnpm audit` is a
signal, not a guarantee). If a credential is ever committed, rotate it: removing it from the
tree does not remove it from git history.
