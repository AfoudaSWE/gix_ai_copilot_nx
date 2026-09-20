# Phase 8 testing

## Executed validation

- Baseline `pnpm validate`: passed, all 106 tasks served from Nx cache. This was treated as a starting point, not fresh completion evidence.
- Fresh `pnpm validate --skip-nx-cache`: lint, typecheck, tests and build passed for 27 projects / 106 tasks. Affected-package checks were rerun after follow-up changes. Final result counts are recorded in [Status](Phase_8_Status.md).
- `git diff --check`: passed; Git emitted only existing LF/CRLF normalization notices.
- Frozen lockfile installation passed. No additional dependency versions were introduced during completion review.
- Built-output benchmark ran successfully, including a real local HTTP call and a real stdio MCP child process.

The normal suite is deterministic for the new examples: real-provider cases require `RUN_OPENAI_SMOKE=1` as well as the API key. Existing earlier-phase smoke-test behavior is unchanged. Browser Playwright tests were not rerun; the browser project's lint/typecheck checks were included. No Phase 8 browser UI was added.

## Security and integration evidence

| Area | Evidence |
| --- | --- |
| Parser, schemas, naming, exposure, auth, error taxonomy, retries, refresh | `packages/openapi/src/*.spec.ts` and `packages/tools/src/*schema*.spec.ts` / credential tests |
| URL safety and credential authority | `openapi/src/security-hardening.spec.ts`: redirect refusal, dot traversal, reserved headers, echo redaction |
| HTTP cancellation, timeout, result bounds | Actual local HTTP server, finite deadline, aborted signal, malformed/oversized bodies |
| MCP connection/discovery/lifecycle | Actual installed SDK with in-memory server, stdio examples, silent-child handshake timeout and remote-close deregistration |
| MCP timeout/cancellation | SDK call deadline and abort tests in `mcp/src/client.spec.ts` |
| Shared firewall and approvals | `examples/openapi/src/governance.spec.ts`: real HTTP mutation remains unexecuted until supervisor approval; same approval store handles model-proposed MCP write |
| Permissions, tenants, disabled destructive tools | Mixed catalog discovery, direct invocation denials, cross-tenant rejection, absent delete tool |
| Malicious remote descriptions/results | Untrusted instructions do not add authority; forbidden calls still denied; sensitive output redacted before continuation |
| Server enforcement | External call on a server without firewall returns failure and does not dispatch |
| Audit | Existing correlated decision/approval/execution path plus safe source IDs, duration and external status |
| Prior phases | Full workspace Phase 1-7 suites and builds included |

## Real OpenAI validation

The existing enterprise example's local environment configured `gpt-4o-mini`. Its key was passed only to the Node test processes; it was not printed, copied into source or sent to the local integration servers.

Commands from each example directory used `RUN_OPENAI_SMOKE=1` and:

```powershell
node --env-file=../react-enterprise/.env ../../node_modules/vitest/vitest.mjs run src/openai-smoke.spec.ts
```

| Flow | Result | Measured test duration |
| --- | --- | --- |
| OpenAI -> generated `vas.getApplication` -> firewall -> local HTTP -> OpenAI answer | PASS; answer contains applicant Hopper | 3,114 ms |
| OpenAI -> generated `vas.assignApplication` -> approval -> local HTTP -> continuation | PASS; no mutation before approval; local officer becomes OFF-B | 1,516 ms |
| OpenAI -> generated `mcp.widgets.getWidget` -> firewall -> actual MCP process -> answer | PASS; answer describes screwdriver | 3,182 ms |

These are actual provider calls, not prompt-matched responses. Approval in the live automated check was an explicit test decision against local fixture data. No production enterprise data was mutated.

## Performance evidence

Reproducible source: `examples/openapi/src/benchmark.ts`; run built output with `node examples/openapi/dist/benchmark.js`. Raw measurements: [benchmark.json](benchmark.json). One local run, not a throughput/load-test claim.

| Measurement | Result |
| --- | ---: |
| Synthetic JSON source loading/parsing (includes Response setup/decoding) | 25.87 ms |
| 1,000-candidate generation, 20 explicitly selected | 19.78 ms |
| Generated/model-visible catalog | 20 tools; 980 denied |
| Serialized 20-tool manifest size | 5,571 bytes |
| Local five-operation OpenAPI generation | 2.19 ms |
| OpenAPI registration including generation | 2.46 ms |
| MCP process startup/connection | 809.29 ms |
| MCP discovery | 9.95 ms |
| MCP registration including connection/discovery | 820.23 ms |
| Local HTTP adapter call | 31.48 ms |
| Local MCP adapter call | 6.83 ms |

The OpenAPI example report discovers five operations, generates four and denies one, with zero unsupported/skipped/conflicts/warnings. The benchmark's MCP policy selects one of three tools; its ordinary interactive example explicitly selects all three. Adapter timing calls are trusted host measurements; governance is tested separately through the server.
