# Phase 3 — React Copilot UI

Phase 3 adds a headless React SDK and an independently consumable component package using
the established `@gixcopilot/*` scope. It does not implement Phase 4 or later features.

| File                                        | Contents                                          |
| ------------------------------------------- | ------------------------------------------------- |
| [Architecture](Phase_3_Architecture.md)     | Package direction, local state and streaming flow |
| [Implementation](Phase_3_Implementation.md) | Code responsibilities, dependencies and tradeoffs |
| [Status](Phase_3_Status.md)                 | Acceptance and completion report                  |
| [Testing](Phase_3_Testing.md)               | Executed checks and measured evidence             |
| [Decisions](Phase_3_Decisions.md)           | ADR index and compatibility choices               |
| [API](Phase_3_API.md)                       | All exported hooks, components and public types   |
| [Files](Phase_3_Files.md)                   | Created and modified files                        |
| [Issues](Phase_3_Issues.md)                 | Issues found, fixes, and known limits             |
| [Handoff](Phase_3_Handoff.md)               | Running the examples and future maintenance       |

Prior records: [Phase 1](../phase-01/Phase_1_Docs.md) and
[Phase 2](../phase-02/Phase_2_Docs.md). The existing canonical global architecture is
`docs/architecture/overview.md`; `docs/ARCHITECTURE_OVERVIEW.md` and `docs/ROADMAP.md` did
not exist at intake. The project skill and global status table remain the roadmap.

Quick start from the workspace root: `pnpm install`, `pnpm build`, `pnpm demo:react`.
Open <http://127.0.0.1:5173> or the headless example on port 5174.
