# Enterprise security & HITL example (Phase 7)

Demonstrates the AI Action Firewall and human-in-the-loop approval pipeline end to end:
authentication, RBAC/ABAC, tenant isolation, risk-based approval routing (user confirmation,
supervisor, two-person, admin), dry-run previews, PII redaction, and a real audit trail - all
enforced server-side through `@gixcopilot/security`, regardless of whether an action was
requested by a person clicking a button or by a real OpenAI model in a chat turn.

No mock security logic exists anywhere in this example. There is no "pretend" identity
system standing in for a real one - `createStaticAuthenticationAdapter` is `@gixcopilot/
security`'s own deterministic, credential-free adapter, documented as exactly what it is: a
fixture for demos and tests, not a real authentication mechanism (see Section 14's own
"replace with the host application's session adapter" note in `src/backend.ts`).

## What this proves

- **The firewall protects every path to an action identically.** A "Reassign" button click
  in the UI (`useInvokeTool`, no model involved) and a real OpenAI model's tool call both
  arrive at the exact same `@gixcopilot/security` `ActionFirewall` on the server - neither
  can bypass it.
- **Authorization comes from the server, never the client.** Switching the "Requester"
  dropdown to `viewer` and clicking "Delete permanently" is denied with `PERMISSION_DENIED`
  - the button doesn't just hide, the *server* refuses the action even if you forge the
  request.
- **Tenant isolation is enforced by policy, not by convention.** `APP-1024` belongs to the
  demo tenant; a registered ABAC policy (`applications.tenant-and-status` in `src/backend.ts`)
  denies any cross-tenant access with `TENANT_MISMATCH`, regardless of which tool requested it.
- **Approval is a real pause, not a simulated one.** Requesting a supervisor-level action
  suspends the run - the tool has not executed - until a *different* identity (the requester
  cannot self-approve above `user-confirmation`) approves or rejects it in the "Approval desk"
  panel, which is the real `ApprovalCard` component from `@gixcopilot/ui` reading real
  `approval.*` protocol events.
- **PII never reaches the model or the client unredacted.** Every application record's
  `passportNumber`/`email` fields are masked by a `DataPolicy` before they leave the server -
  inspect the "Read application" result if you want to see this directly.

## Setup

From the repository root:

```sh
pnpm install
pnpm build
pnpm --filter @gixcopilot/react-enterprise server   # terminal 1 - backend on :4322
pnpm --filter @gixcopilot/react-enterprise dev       # terminal 2 - Vite dev server on :5178
```

Open <http://127.0.0.1:5178>.

### Enabling real OpenAI chat (optional)

```sh
cp examples/react-enterprise/.env.example examples/react-enterprise/.env
# edit .env and set OPENAI_API_KEY=sk-... (OPENAI_MODEL defaults to gpt-4o-mini)
```

Without a key, the server still runs and every action/approval/denial/audit capability above
works fully through the "Application actions" buttons - only the natural-language chat panel
is unavailable (the page says so, and the server fails fast with a clear error rather than
substituting a fake model if a run ever tries to use it unconfigured).

## Using it

- **Requester** (top right): switch between `viewer` (read-only) and `officer` (can request
  writes) to see permission-aware tool discovery and execution-time denial.
- **Application actions**: each button requests one action directly, through the same
  firewall a chat request would go through - "Read application," "Confirm assignment"
  (`user-confirmation`), "Supervisor reassignment," "Two-person transfer," and "Delete
  permanently" (`admin`), each mapped to a different approval level in `src/backend.ts`.
- **Approval desk**: switch the **Reviewer identity** dropdown to `supervisor`, `supervisor2`,
  or `admin` to approve/reject pending requests. A two-person transfer needs two *distinct*
  reviewer identities - approving twice as the same one does not satisfy it. The list also
  shows a real, live action history.
- **Chat** (if configured): ask the model to read, reassign, or delete an application in
  plain language - it goes through the identical firewall/approval pipeline as the buttons.

## Tests

`pnpm --filter @gixcopilot/react-enterprise test` runs a deterministic, credential-free
integration test (`src/backend.spec.ts`) confirming the no-key path never substitutes a fake
model and that PII redaction/permission denial work over real HTTP. The broader security
pipeline itself (RBAC, ABAC, tenant isolation, all five approval levels, expiration,
cancellation, reauthorization, two-person idempotency, PII, audit) is covered by
`@gixcopilot/server`'s own `security-integration.spec.ts` and `security-boundaries.spec.ts`,
and by `@gixcopilot/security`'s unit tests - this example reuses that exact engine rather than
reimplementing or re-testing it.

## Security notes

- `OPENAI_API_KEY` is read only in `src/backend.ts`/`src/server.ts` (Node process code) -
  never bundled into the browser build; `vite.config.ts` never defines it for the client.
- `IDENTITIES` in `src/backend.ts` are demonstration fixtures. A real application replaces
  `createStaticAuthenticationAdapter` with an adapter that authenticates against its own
  session/JWT/OIDC system - nothing else in the firewall pipeline changes.
- `.env` is gitignored at the repository root; never commit a real key.
