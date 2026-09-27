# Versioning, compatibility and deprecation

All SDK packages follow SemVer and release together (one fixed version group via `nx
release`). Before 1.0.0, a minor bump may contain breaking changes, but every one is still
documented in [migrations](migrations/README.md).

| Surface | Breaking (major) | Compatible (minor/patch) |
| --- | --- | --- |
| Public TypeScript API (package root exports) | Removing or renaming an export; changing a signature, return shape, default or required option | New exports; new optional options; widened input types |
| Protocol (events, messages, errors) | Removing an event or field; changing a field's meaning; making a field required | New optional fields; new event types (clients ignore unknown events); new error codes (clients pass codes through) |
| Configuration (`@gixcopilot/config`, env vars) | Removing or renaming a key or variable; a stricter default that changes behavior | New optional keys with behavior-preserving defaults |
| Database | A migration that drops or rewrites data the previous release reads | Additive migrations (new tables, nullable columns, indexes) |
| Events to observers/telemetry | Removing a span or attribute consumers rely on | New spans or attributes |

**Deprecation**: mark with TSDoc `@deprecated <what to use instead>` in a minor release, keep
it for at least one further minor release, list it in the release notes, and remove it only in
the next major. A security issue may force faster removal; the reason is documented.

**Protocol compatibility**: client and server may run different compatible versions.
`PROTOCOL_VERSION` is carried on every event. Receivers ignore unknown event types and unknown
fields, and new error codes pass through the client unchanged. Prefer feature detection (does
the server advertise the capability or tool?) over version sniffing.

**Database vs software rollback**: migrations are expand/migrate/contract, so the previous
release keeps working on the new schema until the contract step, which ships at least one
release later ([DATABASE](production/DATABASE.md)).
