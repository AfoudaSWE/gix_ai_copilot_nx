# Phase 2 Documentation Index

Phase 2 — LLM Runtime & Streaming. This directory is the phase-specific documentation set
required by the Phase 2 prompt. Broader, ongoing project documentation lives at the repo
root under `docs/` (`PROJECT_STATUS.md`, `DECISIONS.md`, `TECHNICAL_DEBT.md`,
`architecture/overview.md`) and `docs/adr/`.

| File                                                   | Contents                                                                                 |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| [Phase_2_Architecture.md](Phase_2_Architecture.md)     | The Phase 2 architecture diagrams (model runtime, provider registry, streaming pipeline) |
| [Phase_2_Implementation.md](Phase_2_Implementation.md) | What was built, package by package                                                       |
| [Phase_2_Status.md](Phase_2_Status.md)                 | Acceptance criteria checklist with pass/fail                                             |
| [Phase_2_Testing.md](Phase_2_Testing.md)               | Exact validation commands run and their results                                          |
| [Phase_2_Decisions.md](Phase_2_Decisions.md)           | Key decisions made this phase, with pointers to the full ADRs                            |
| [Phase_2_API.md](Phase_2_API.md)                       | New and changed public APIs                                                              |
| [Phase_2_Files.md](Phase_2_Files.md)                   | Files created and modified                                                               |
| [Phase_2_Issues.md](Phase_2_Issues.md)                 | Real bugs found and fixed during this phase's own validation                             |
| [Phase_2_Handoff.md](Phase_2_Handoff.md)               | What Phase 3 (or any future phase touching the model runtime) needs to know              |

## A Note on Phase 1's Documentation Set

At the time this `phase-02/` directory was written, the Phase 2 prompt had asked to read a
`docs/phases/phase-01/*` directory that did not yet exist — Phase 1's contemporaneous
documentation was (and still is) `docs/architecture/overview.md` and `docs/adr/0001`–`0005`,
plus each package's own README. Per Phase 2 Section 2 ("Do not assume the original Phase 1
prompt exactly matches repository reality — the repository is the source of truth"), that
was treated as the authoritative Phase 1 record rather than retroactively fabricated into
the `phase-01/` shape at the time. A `docs/phases/phase-01/` directory was subsequently
added on explicit request, after Phase 2 completed — see its own
[Phase_1_Docs.md](../phase-01/Phase_1_Docs.md) for how it was reconstructed and why it
still defers to the original ADRs as the primary source.
