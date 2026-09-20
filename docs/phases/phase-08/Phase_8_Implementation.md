# Phase 8 implementation

The initial implementation already supplied three packages, conversion/credential helpers, registration/refresh, local examples and unit tests. The completion review found that the examples bypassed the firewall and that most required Phase 8 documentation was absent.

The review completed these behaviors:

- Explicit OpenAPI selection; safe reserved headers and case-insensitive credential precedence.
- HTTP redirect refusal, dot-segment checks, finite loading/execution deadlines, bounded response consumption and invalid-JSON handling.
- JSON Schema constraint preservation, safe `allOf` intersections, null/dictionaries, read-only inputs, write-only outputs, declared response validation and unsupported-schema diagnostics.
- Source document digest, serialized refresh, disposal protection and stale MCP deregistration.
- MCP initialization cleanup, bounded paginated tool discovery, cancellation/deadline tests, safe error normalization and trimmed descriptions.
- Preservation of normalized `CopilotError` codes by ToolRuntime, source-aware audit and optional integration telemetry.
- Firewall/approval wiring in both examples, real CLI approval, built MCP-process path, explicit live-test opt-in and mixed-source governance coverage.

## Dependency review

| Dependency | Installed version / license | Use and boundary |
| --- | --- | --- |
| `yaml` | 2.9.1 / ISC | Server-side YAML parser; project-owned source and operation contracts |
| `@modelcontextprotocol/sdk` | 1.30.0 / MIT | Official transport/protocol client; no public SDK types |
| `zod` | 4.6.5 / MIT | Existing workspace schema system reused; no second validator runtime |

Versions and licenses were checked in installed package manifests. The official MCP client avoids a bespoke protocol implementation but brings transitive Node/HTTP dependencies; keep it out of React bundles. YAML parsing adds a small focused dependency rather than a second OpenAPI framework. Versions are pinned in the lockfile. This review is not a dependency vulnerability audit.

No new runtime protocol event or `ToolSource` value was required. Backend tools already use the native source with server execution location. `toToolNameSegment` moved from an internal generative-ui module to shared tools; the two consumers and its tests moved with it.

No deployment, publishing, commits or Phase 9 work was performed. See [files](Phase_8_Files.md) for the actual change inventory.
