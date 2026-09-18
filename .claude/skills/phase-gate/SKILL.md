---
name: phase-gate
description: Mandatory phase-gate protocol. Load before starting or resuming any implementation work. Prevents automatic phase progression and future-phase scope creep.
---

# Purpose

Enforce strict sequential development across the project's 12 fixed phases (see
[[ai-copilot-project]]). This is the most important skill in the project: **Claude must
never automatically begin another phase**, and must never implement future-phase
functionality just because it appears useful while working on the current phase.

# When to Apply

Always. Load this skill before starting any implementation task, before resuming after a
break, and before deciding scope for any change.

# Required Rules

1. Development occurs sequentially, one phase at a time.
2. Claude works ONLY on the phase explicitly requested by the user for the current session.
3. Claude MUST NOT automatically begin another phase after finishing the current one.
4. Claude MUST NOT implement future-phase functionality because it appears useful,
   convenient, or "while I'm in here."
5. Claude MAY create an abstraction boundary (an interface, an extension point) needed by
   the current phase, but MUST NOT implement the future feature behind that boundary.
6. If a task implies work spanning multiple phases, stop and ask the user to confirm scope
   rather than assuming the larger scope is authorized.

# Architecture / Patterns — The Phase Loop

**At the beginning of a phase:**

1. Identify the current phase explicitly (ask if ambiguous).
2. Read the relevant skills for that phase per [[ai-copilot-project]]'s phase mapping.
3. Inspect repository state (`git status`, existing packages, existing docs) before assuming
   what already exists.
4. Produce or confirm an implementation plan with the user before writing code.
5. Work only inside the approved scope.

**During implementation:**

1. Follow the current phase's requirements only.
2. Keep changes scoped to files and packages relevant to the phase.
3. Test continuously as you go, not only at the end.
4. Do not hide failing tests, lint errors, or type errors.
5. Do not silently expand scope into adjacent phases or unrequested features.

**At completion:**

1. Run required tests — actually execute them.
2. Run lint — actually execute it.
3. Run typecheck — actually execute it.
4. Run build where applicable — actually execute it.
5. Review the `git diff` for unintended changes.
6. Perform the [[code-review]] self-review checklist.
7. Update documentation required by the phase ([[documentation]]).
8. Produce a completion report: what changed, what was validated, what remains.
9. Identify remaining issues honestly — do not paper over gaps.
10. STOP. Do not continue to the next phase.

# Anti-Patterns

- Finishing Phase N and immediately starting Phase N+1 without being asked.
- Adding a "quick" implementation of a Phase 7 security feature while doing Phase 2 work.
- Building scaffolding for packages that belong to a later phase "to save time later."
- Claiming a test suite or build passed without having run it (see [[code-review]]).
- Treating an abstraction boundary as license to fill it with the future feature's logic.

# Validation Checklist

- [ ] The phase being worked on was explicitly named by the user
- [ ] No code, config, or docs for a different phase were introduced
- [ ] All required checks (test/lint/typecheck/build) were actually run, not assumed
- [ ] A completion report was produced and the assistant stopped afterward
- [ ] The user was not left to discover unauthorized scope expansion in the diff
