# Developer Studio Enhancement — Status

> Plan: [ENHANCEMENT_PLAN.md](ENHANCEMENT_PLAN.md). Brief:
> [developer_studio_Prompt.md](../prompts/developer_studio_Prompt.md). Last updated 2026-09-30.
> Post-Phase-12 enhancement, not a phase. Nothing committed or published yet.

## Final status: **INCOMPLETE**

The core is built and verified. The React Studio with a live `@gixcopilot/ui` preview, browser
E2E tests, and `createCopilot` wiring are not done (see [Remaining](#remaining)).

## Milestones

| #  | Milestone | Status |
| -- | --------- | ------ |
| M0 | Plan, status, ADR 0023, DECISIONS index | Done |
| M1 | `@gixcopilot/studio` scaffold, Nx tag + boundary, workspace guard, secret rules, bounded walker | Done |
| M2 | Discovery (detectors, TS-AST, OpenAPI, components, context, auth, permissions, knowledge, re-scan) | Done |
| M3 | Diagnostics lifecycle | Done |
| M4 | Proposals, generator contract, 9 generators, risk heuristics, edit validation, security review | Done |
| M5 | Apply engine (diff, secret scan, conflicts, transactional write, post-validation, rollback) | Done |
| M6 | Server plugin, `/__gix` page, development API, Test Connection, config view | Done |
| M7 | Docs (`docs/developer-studio/*`, package README, root README, PROJECT_STATUS) | Done |
| M8 | React Studio with real `@gixcopilot/ui` live preview + Playwright E2E | **Not started** |
| M9 | `createCopilot({ studio })` wiring + example app | **Not started** |

## Completion gate (§89)

```text
ARCHITECTURE
Development Plane:            PASS
Application Plane:            PASS
Plane Isolation:              PASS   (assertApplicationPlane, reserved namespaces, review + apply checks)
Production Isolation:         PASS   (/__gix and /__gix/api/* 404; tested for plugin and registerStudio)

CONFIGURATION
Appearance:                   FAIL   values save through review; no live @gixcopilot/ui preview (§7)
Model Configuration:          PASS
OpenAI Secret Handling:       PASS   (write-only, memory-only key; tested it never reaches a response)
Copilot Configuration:        PASS
Security Configuration:       PASS   (read-only view of the host's @gixcopilot/security setup)

DISCOVERY
Project / APIs / Components / Context / Authentication / Permissions / Knowledge:  PASS
Read-only Guarantee:          PASS   (type has no writer, lint rule, byte-identical snapshot test)

DIAGNOSTICS
Continuous / Pre-Discovery / Post-Discovery / Post-Generation / Post-Apply:  PASS

GENERATORS
Generator Framework and all 8 required generators:  PASS  (+ configuration generator)
  Generated code type-checks against the real packages (tested, every item selected)

PROPOSALS
Structured Proposal / Preview / Diff / Selective Approval / Reject / Conflict Detection:  PASS

APPLY
Generator Cannot Mutate / Explicit Approval Required / Apply Engine /
Workspace Protection / Secret Scan / Post-Apply Validation:  PASS

SECURITY
Action Firewall / Path Traversal / Secret Protection / Dev API Protection /
Production Studio Protection:  PASS

QUALITY
Lint / Typecheck / Tests / Build:  PASS   pnpm validate, 69 projects
E2E:                          NOT RUN  no browser test for the Studio page yet
Documentation:                PASS

FINAL STATUS: INCOMPLETE
```

## Verification (run 2026-09-30)

- `pnpm validate` (lint, typecheck, test, build): **69/69 projects passed**, 1,505 tests passed,
  6 skipped (the existing optional/Docker-gated suites), 0 failed.
- `@gixcopilot/studio`: 58 tests in 5 files (planes and workspace, discovery on Nx/React/Fastify,
  Angular, Vue, Express/NestJS fixtures, generators and apply lifecycle, generated-code typecheck,
  HTTP plugin). The generated-code typecheck was confirmed to fail on a deliberately broken file.
- `node tools/secret-scan.mjs`: 0 findings.
- The Studio page was **not** opened in a real browser this session.

## Bugs found by tests and fixed

- Auth → Security emitted one policy per source for the same tool (OpenAPI + route), producing a
  duplicate object key that would not compile. It now merges by tool name.
- Approving a proposal with blocking findings returned a generic state error. It now returns the
  security findings.

## Decisions taken during implementation

- `@gixcopilot/studio` is `private` (unpublished) until a release decision (§90 stop condition).
  Release tooling already skips private packages.
- The Studio UI for this iteration is a self-contained page served by the plugin (no build step,
  strict CSP). The React app with a live preview is M8.
- API keys are held in server memory for the session only (plan decision 4).
- Recommended doc files were consolidated. Discovery pages are one `DISCOVERY.md`; proposal,
  preview, approval and apply pages are one `PROPOSALS_AND_APPLY.md`.
- The docs portal (`apps/docs`) nav was not updated, to avoid advertising an unpublished package.

## Remaining

1. **M8**: React Studio app embedding the real `@gixcopilot/ui` `CopilotChat` as the Appearance
   live preview, and Playwright E2E for the Studio page (keyboard, axe scan, flows).
2. **M9**: `createCopilot({ studio })` in `@gixcopilot/node` and an example app using the Studio.
3. Development agents/skills are catalogued but no model-driven development agent exists yet;
   generators are deterministic. §46 per-request tool filtering applies once one is added.
4. Publish decision for `@gixcopilot/studio`, then the `npx gixcopilot init` task (§90, out of
   scope here).
