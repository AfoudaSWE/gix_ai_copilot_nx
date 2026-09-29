# Proposals, review and apply

## Proposal model

A `ChangeProposal` holds `fileChanges`, `configChanges`, `tools`, `context`, `ui`, `agents`,
`skills`, `knowledge`, `policies`, `diagnostics`, `warnings`, `conflicts`, `securityReview`, a
`summary` and a `status`. Each file change records the file's SHA-256 at generation
(`baseHash`, or `null` if it did not exist).

```text
draft ──► ready-for-review ──► approved ──► applied
  ▲              │    ▲            │    └──► failed (applied with validation errors,
  │              ▼    │            │               or rolled back after a write error)
  └──────── rejected  └────────────┘ (conflict found at apply → back to review)
```

Any other transition throws. A proposal with blocking security findings stays `draft`.

## Preview and diff

The Review page shows files created/modified/removed, configuration changes, tools
added/changed/disabled, context, generative UI, agents, skills, knowledge, security policies,
warnings and conflicts. Each file has a unified diff against the file as it is now.

## Selective approval and edits

- Tick or untick any item. Unselected items produce no files. A tool's policy follows its tool.
- Editable before approval: tool name, description, risk, permission, approval level, enabled,
  agent assignment; context description and sensitivity; descriptions and selection elsewhere.
  Every edit is schema-validated. Unknown fields are rejected.
- Edits cannot bypass security: approval re-runs the review, which blocks an approval level
  below the Action Firewall's default for the chosen risk, an enabled destructive tool without a
  permission, development-plane names, duplicates, secrets in output, and paths outside `.gix/`.
  Lowering a risk below the heuristic is allowed but flagged.

**Reject All** changes nothing in the repository. The proposal stays editable.

**Approve Selected Changes** is the only way into apply.

## Apply engine

```text
approved proposal
  → re-run security review
  → workspace guard on every path (no .., absolute, home/.ssh, symlink escape, .git, node_modules)
  → secret scan (block)
  → conflict check: current hash == baseHash, else stop and write nothing
  → write each file through a temp file + rename, keeping backups; on any write error, restore all
  → post-apply validation
```

Validation runs the project's own detected scripts (`typecheck`, `lint`, `test` by default)
with the detected package manager. It never assumes `pnpm`. A missing script is reported as
skipped. It also re-parses `.gix/copilot.config.json`, re-scans written files for secrets
(`security`), and re-checks the plane rule (`integration`). Command output is redacted.

- All checks passed → `APPLY COMPLETE`, status `applied`.
- Any check failed → `APPLIED WITH VALIDATION ERRORS`, status `failed`, with what failed and the
  output. The Studio never reports success when validation failed.
- **Roll back this apply** restores the previous contents of files the apply wrote, but only for
  files unchanged since. Files you edited afterwards are left alone and reported. Rollback
  history is kept for the current Studio session only.

A second apply of the same proposal is refused.
