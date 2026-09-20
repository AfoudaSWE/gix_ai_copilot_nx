# Phase 8 issues and limits

## Resolved during completion review

| Finding | Resolution / evidence |
| --- | --- |
| Examples authenticated users but omitted Action Firewall | Both use Phase 7 firewall and approval store; governance and live approval tests |
| No mandatory explicit OpenAPI selection | `include` / operation configuration activates only reviewed candidates |
| Headers could supply Authorization or override credentials | Reserved headers excluded; case-insensitive credential precedence; echo-redaction test |
| Redirects and dot path segments escaped intended URL boundaries | Redirect refusal and dot-segment rejection; HTTP boundary tests |
| Unbounded response reads / malformed JSON treated as successful text | Configurable 1 MiB default cap; JSON errors normalize safely |
| `allOf` overwrote earlier constraints; malformed regex could throw generation | Intersection conversion and diagnostic fallback; shared converter tests |
| Read-only/write-only and response schemas were ignored | Direction-aware conversion and response validation |
| Remote MCP closure retained registered tools; failed connect leaked transport | State subscription deregistration and handshake cleanup tests |
| Concurrent refresh/dispose could resurrect tools | Serialized refresh, disposed guards |
| Raw error bodies/messages could expose credentials | Safe normalized errors; known credential values scrubbed from tool results |
| Runtime flattened normalized timeout/rate-limit codes | Preserve existing `CopilotError` taxonomy |
| Built MCP example looked for a missing copied script | Resolve the checked-in process script from both source and dist |
| Interactive write demo could wait forever for approval | CLI asks for a human decision and posts it to the existing approval API |
| Completion docs and security/performance evidence absent | Ten Phase 8 documents, package READMEs, measured benchmark and regression/live tests |

## Supported limits

- Structural OpenAPI 3.0/3.1 validation and a bounded JSON Schema subset; not a full spec linter. Unsupported `oneOf`/`anyOf`, arbitrary unions/keywords, multipart/form bodies, complex parameter serialization and external/cyclic refs are diagnosed. Constrained `$ref` siblings are rejected rather than silently weakened.
- Credentials: bearer, basic, API-key/custom HTTP headers and host callbacks. OAuth acquisition/rotation and API keys in query/cookies require host adapters; do not expose them to model input.
- Redirect refusal prevents redirect-based destination changes. Hosts must trust/allowlist configured spec/base/MCP URLs and enforce network egress/DNS rules for their deployment. Private APIs and localhost remain intentionally usable.
- Response schemas are optional. Absent schemas normalize results without claiming domain validation. Domain PII filtering requires the host data policy. Custom executors and transforms are trusted server code and must honor the same guarantees.
- Cancellation stops waiting and propagates to transports. It cannot undo a remote mutation already accepted. Dispose removes registrations; cancel host runs separately during shutdown.
- MCP tools are paginated with a finite page cap. Resource/prompt discovery currently returns the first page; resource reads expose the first text item. Binary payloads are metadata only. These are explicit Phase 8 foundation limits, not a RAG implementation.
- MCP credentials scope a connection. Per-user/tenant connections must be managed by the host. Custom clients without `subscribeState` require host-driven refresh/dispose after connection loss.
- Refresh state, integration catalog, sample data, approval store and audit sink are process-local. Multi-process hosts need shared Phase 7 adapters. No background refresh or reconnect scheduler.
- Tests use local test APIs/servers. No production enterprise API, live remote HTTP MCP service or browser UI was exercised. stdio and in-memory MCP were exercised with the installed SDK.

Phase 9+ remains locked. Knowledge/RAG, vector stores, memory, agents and DevTools are planned phases, not Phase 8 technical debt.
