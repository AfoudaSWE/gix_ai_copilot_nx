# AI Copilot SDK — Engineering Skills

This directory is the engineering instruction system for the AI Copilot & Agent SDK
project. Each subdirectory is a Claude **skill**: a focused, enforceable set of rules for
one concern in the codebase (architecture, TypeScript, security, testing, a specific
package's conventions, and so on).

Skills exist so that engineering standards are explicit, discoverable, and consistently
applied across a project whose scope spans 36 distinct concerns and 12 development phases
— rather than re-derived ad hoc in every conversation.

## Directory Structure

```text
.claude/
└── skills/
    ├── README.md                  ← this file
    ├── ai-copilot-project/        ← master/navigation skill, read first
    ├── phase-gate/                ← mandatory phase-progression control, read every session
    └── <34 other skills>/
        └── SKILL.md
```

Every skill directory contains exactly one `SKILL.md` with YAML frontmatter (`name`,
`description`) followed by the skill's rules.

## How Skills Are Selected

1. Read [`CONSTITUTION.md`](../../CONSTITUTION.md) at the repo root first — it's the
   non-negotiable law (vision, framework-independent-core, phase discipline, trust boundary,
   verified completion, dependency discipline) that every skill below operates under. Skills
   are the *how*; the constitution is the *why it's non-negotiable*.
2. Then [`ai-copilot-project/SKILL.md`](ai-copilot-project/SKILL.md) — the master
   navigation skill. It contains the **routing table** below, mapping a task type to the
   skill(s) required.
3. Always also load [`phase-gate/SKILL.md`](phase-gate/SKILL.md) before doing
   implementation work — it governs which phase's work is currently in scope and forbids
   automatic progression to the next phase.
4. Load the specific skill(s) the routing table names for the task at hand. Skills
   cross-reference each other with `[[skill-name]]` links — follow those links rather than
   assuming a related rule is duplicated locally.

## The Master Skill

[`ai-copilot-project`](ai-copilot-project/SKILL.md) is intentionally an index, not an
encyclopedia. It states the project vision, the architectural principle
(`Core → Protocol → Runtime → Adapters`), the technology direction, the 12 fixed phases,
and routes to specialized skills. It does not restate the full rule set of any specialized
skill — that would create two sources of truth that could drift apart.

## Phase-Gate Behavior

The project has exactly 12 fixed, sequential phases (Foundation & Architecture through
Production Platform + Ecosystem). [`phase-gate`](phase-gate/SKILL.md) is the mandatory
control skill: **Claude must never automatically continue from one phase to the next**,
must never implement future-phase functionality "because it's useful," and must produce an
honest completion report and stop at the end of each unit of work. Phase progression is
always explicitly requested by the user.

## Skills Table

| Task | Required Skills |
|---|---|
| Architecture | project-architecture |
| TypeScript implementation | typescript-standards |
| Monorepo | nx-monorepo |
| Public SDK API | sdk-design |
| Protocol | protocol-design |
| Node backend | node-backend |
| React | react-sdk |
| Angular | angular-sdk |
| Model runtime | ai-runtime |
| Tools | tool-system |
| Agents | agent-architecture |
| Context | context-engine |
| Generative UI | generative-ui |
| Security | security + action-firewall |
| Approval | hitl |
| OpenAPI | openapi-tools |
| MCP | mcp |
| RAG | rag |
| Memory | memory |
| Tracing | observability |
| Tests | testing |
| AI evaluation | ai-evals |
| DevTools | devtools |
| Database | database |
| Jobs | redis-jobs |
| API | api-design |
| Performance | performance |
| Accessibility | accessibility |
| Documentation | documentation |
| Git | git-workflow |
| Review | code-review |
| Dependencies | dependency-policy |
| Compatibility | backward-compatibility |
| Every phase | phase-gate |

## Full Skill List (36)

`ai-copilot-project`, `project-architecture`, `typescript-standards`, `nx-monorepo`,
`sdk-design`, `protocol-design`, `node-backend`, `react-sdk`, `angular-sdk`, `ai-runtime`,
`tool-system`, `agent-architecture`, `context-engine`, `generative-ui`, `security`,
`action-firewall`, `hitl`, `openapi-tools`, `mcp`, `rag`, `memory`, `observability`,
`testing`, `ai-evals`, `devtools`, `database`, `redis-jobs`, `api-design`, `performance`,
`accessibility`, `documentation`, `git-workflow`, `code-review`, `dependency-policy`,
`backward-compatibility`, `phase-gate`.

## Adding a New Skill

1. Create `.claude/skills/<new-skill-name>/SKILL.md` with frontmatter (`name`,
   `description`) matching the directory name.
2. Follow the standard structure: Purpose, When to Apply, Required Rules,
   Architecture/Patterns, Anti-Patterns, Validation Checklist (adapt if another structure
   genuinely fits better).
3. Add a row to the routing table in `ai-copilot-project/SKILL.md` and to this README.
4. If the skill applies to a specific phase, add it to the phase mapping in
   `ai-copilot-project/SKILL.md`.
5. Run `validate_skills.py` (see below) to confirm structure and frontmatter are valid.

## Modifying an Existing Skill

- Keep the rules enforceable ("public package APIs must not expose internal implementation
  types") rather than vague ("write good code").
- If a rule genuinely belongs to another skill's domain, link to it (`[[skill-name]]`)
  instead of duplicating it — see "Avoiding Duplicated Rules" below.
- Update the skill's `description` frontmatter if its scope changed, since that's what
  determines when Claude loads it.

## Avoiding Duplicated Rules

Long, cross-cutting rule sets are owned by exactly one skill and referenced everywhere
else via `[[skill-name]]`:

- Tool execution security → [[action-firewall]]
- General security posture → [[security]]
- TypeScript rules → [[typescript-standards]]
- Testing requirements → [[testing]]
- Approval workflows → [[hitl]]

If you find a rule copy-pasted into more than one skill, that's a bug — consolidate it into
its owning skill and replace the duplicate with a link.

## Validation

A validation script, `validate_skills.py`, lives alongside this README (see
[`validate_skills.py`](validate_skills.py)). It uses only the Python standard library (no
new dependency, per `dependency-policy`) and checks:

- Every required directory exists and contains a `SKILL.md`.
- Frontmatter is present, well-formed, and has `name`/`description`.
- The `name` in frontmatter matches the directory name.
- No duplicate skill names.
- The master skill (`ai-copilot-project`) references only real skill names.
- Every skill named in the phase mapping exists.

Run it with:

```sh
python .claude/skills/validate_skills.py
```
