# Phase 1 Files

Files were added across 7 commits (`50202db`..`ae5df8c`), 87 files, 9,106 insertions total.
All of these files now live under the `@gixcopilot/*` scope after the later rename — see
`docs/phases/phase-01/Phase_1_Docs.md`'s naming note.

| Commit    | Message                                                  | Files | Insertions |
| --------- | -------------------------------------------------------- | ----- | ---------- |
| `50202db` | chore(workspace): initialize nx pnpm foundation          | 11    | 5,177      |
| `55b99d6` | feat(protocol): define core protocol contracts           | 19    | 853        |
| `d6a324c` | feat(core): add run lifecycle and event sequencing       | 17    | 925        |
| `6552d23` | feat(server): add http and sse runtime adapter           | 13    | 509        |
| `41a3e43` | feat(client): add framework-independent streaming client | 13    | 724        |
| `abaeab8` | test(integration): verify end-to-end protocol streaming  | 7     | 373        |
| `ae5df8c` | docs(architecture): document phase one architecture      | 7     | 545        |

(The workspace-foundation commit's insertion count is dominated by the generated
`pnpm-lock.yaml`, not hand-written source.)

## By Area

- **Workspace**: `package.json`, `pnpm-workspace.yaml`, `nx.json`, `tsconfig.base.json`,
  `tsconfig.json`, `eslint.config.js`, `.prettierrc.json`, `.prettierignore`, `.gitignore`,
  `tools/vitest.shared.ts`, `pnpm-lock.yaml`.
- **`packages/protocol/`**: `package.json`, `project.json`, `tsconfig.json`,
  `vitest.config.ts`, `README.md`, and `src/` (`index.ts`, `version.ts`, `ids.ts`,
  `errors.ts`, `usage.ts`, `message.ts`, `thread.ts`, `run.ts`, `events.ts`,
  `serialization.ts` + their `.spec.ts` files).
- **`packages/core/`**: same config-file pattern, plus `src/` (`index.ts`, `lifecycle.ts`,
  `sequencer.ts`, `executor.ts`, `cancellable-iteration.ts`, `echo-executor.ts`,
  `runtime.ts` + their `.spec.ts` files).
- **`packages/server/`**: same pattern, plus `src/` (`index.ts`, `app.ts`, `sse.ts`,
  `schemas.ts`, `run-registry.ts` + their `.spec.ts` files).
- **`packages/client/`**: same pattern, plus `src/` (`index.ts`, `client.ts`,
  `transport.ts`, `sse-transport.ts`, `sse-stream.ts` + their `.spec.ts` files).
- **`examples/protocol-demo/`**: `package.json`, `project.json`, `tsconfig.json`,
  `vitest.config.ts`, `README.md`, `src/main.ts`, `src/integration.spec.ts`.
- **`docs/`**: `docs/architecture/overview.md`, `docs/adr/0001`–`0005`, root `README.md`.

For the exact file-by-file diff of any commit, `git show --stat <commit>` reproduces the
list precisely — this file summarizes rather than reproduces it verbatim to stay readable.
