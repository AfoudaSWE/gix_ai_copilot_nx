# AGENTS.md

Entry point for any coding agent (Claude Code, Codex CLI, or other) working in this
repository. Read this file first, every session.

## Read in this order

1. **[CONSTITUTION.md](CONSTITUTION.md)** — non-negotiable project law. Read before writing
   any code. If a request conflicts with it, say so instead of complying silently.
2. **[docs/PROJECT_STATUS.md](docs/PROJECT_STATUS.md)** — which of the 12 phases are
   complete, in progress, or locked, right now. Never infer phase state from README.md; it
   lags.
3. **[.claude/skills/ai-copilot-project/SKILL.md](.claude/skills/ai-copilot-project/SKILL.md)**
   — the full routing table from task type to specialized skill (architecture, TypeScript,
   security, testing, per-package conventions, 36 in total). Claude Code: load it via the
   Skill tool. Any other agent: read it directly, then read the specific skill(s) its table
   names for the task at hand.

## The one rule that overrides everything else

Work only on the phase explicitly named for this session. Never start the next phase
automatically, never implement a future phase's feature because it looks convenient while
you're in the area. Full protocol:
[`.claude/skills/phase-gate/SKILL.md`](.claude/skills/phase-gate/SKILL.md).

## Commands

```sh
pnpm install        # install workspace dependencies
pnpm lint            # nx run-many -t lint
pnpm typecheck       # nx run-many -t typecheck
pnpm test            # nx run-many -t test
pnpm build           # nx run-many -t build
pnpm validate        # lint + typecheck + test + build, in one call
```

Scope any of these to one project with `pnpm --filter @gixcopilot/<pkg> <script>` or
`npx nx run <pkg>:<target>`. Run `pnpm validate` before reporting any task complete — see
[`.claude/skills/code-review/SKILL.md`](.claude/skills/code-review/SKILL.md) for the full
pre-completion checklist.

## Repo map

- `packages/` — `@gixcopilot/*` workspace packages (protocol, core, server, client, react,
  ui, context, tools, generative-ui, security, openapi, mcp, integrations, knowledge, rag,
  memory, vectorstores, providers/*). Full dependency graph in [README.md](README.md).
- `examples/` — one runnable example per phase, each with its own integration test.
- `docs/adr/` — architecture decision records; `docs/DECISIONS.md` indexes them.
- `docs/phases/phase-NN/` — per-phase API/validation/completion record.
- `.claude/skills/` — the engineering rule system; see its own
  [README.md](.claude/skills/README.md) for how skills are organized and added.

## Conventions worth caching here

- Package scope is always `@gixcopilot/*`; new packages register with Nx module-boundary
  tags per [`nx-monorepo`](.claude/skills/nx-monorepo/SKILL.md) — don't hand-roll an import
  path around them.
- ESM-only, NodeNext `.js`-extension imports, no path-alias-to-source (ADR 0005).
- Conventional commits, small focused diffs — see
  [`git-workflow`](.claude/skills/git-workflow/SKILL.md).
- New dependency? Justify it first — see
  [`dependency-policy`](.claude/skills/dependency-policy/SKILL.md).

Everything else — per-domain rules for React, the server, RAG, security, protocol design,
and so on — is a skill, not a paragraph here. Use the routing table in step 3 above rather
than guessing.
