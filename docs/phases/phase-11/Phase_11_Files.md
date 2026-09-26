# Phase 11 files

`@gixcopilot/telemetry` and its initial wiring into `server`, `agents` and `workflows` were
committed before this session (`2518393`). Everything else below is this session's work.

## Created

- `packages/devtools/`: `package.json`, `project.json`, `tsconfig.json`, `vitest.config.ts`,
  `README.md`; `src/{index,types,session,inspectors,bundle,recorder}.ts`;
  `src/server/{index,plugin}.ts`; tests `src/{inspectors,bundle}.spec.ts`,
  `src/server/plugin.spec.ts`, fixture `src/fixtures.spec-helper.ts`.
- `packages/testing/`: package config and README;
  `src/{index,assert,clock,model,tools,security,knowledge,memory,approvals,stack,simulation,harness,replay}.ts`;
  tests `src/{model,harness,replay,simulation,devtools-e2e}.spec.ts`.
- `packages/evals/`: package config and README;
  `src/{index,types,record,runner,compare,gates,report,storage,from-run}.ts`;
  `src/evaluators/{index,common,tools,rag,agents,quality,performance,judge}.ts`;
  test `src/evals.spec.ts`.
- `packages/telemetry/src/{sampling,logs}.ts`, `src/sampling.spec.ts`.
- `apps/devtools/`: `package.json`, `project.json`, `tsconfig.json`, `vite.config.ts`,
  `vitest.config.ts`, `index.html`, `README.md`, `.gitignore`;
  `src/{main,app,api,components}.tsx|ts`, `src/assets.d.ts`, `src/styles.css`;
  `src/panels/{overview,conversation,tools,knowledge,agents,events,evals}.tsx`;
  test `src/app.spec.tsx`.
- `examples/evals/`: package config, README, `.env.example`, `.gitignore`;
  `src/{data,tools,agents,models,app,dataset,target,main}.ts`, `src/integration.spec.ts`.
- `examples/devtools/`: package config, README, `.env.example`, `.gitignore`;
  `src/{backend,models,scenario,main,export-trace}.ts`, `src/integration.spec.ts`.
- `tests/browser/devtools.spec.ts` (Playwright).
- `docs/adr/0016`-`0019`; `docs/phases/phase-11/*` (ten documents).

## Modified

- `packages/telemetry/src/{recording,otel,diagnostics,redaction,index}.ts`,
  `src/instrument/retriever.ts`, `src/{redaction,overhead}.spec.ts`: sampling, browser-safe ids,
  redaction fixes, the OpenTelemetry overhead measurement.
- `packages/devtools/src/types.ts` (rewritten); `src/transport/plugin.ts` moved to
  `src/server/plugin.ts` and completed.
- `packages/agents/src/runtime.ts`: events recorded to diagnostics; agent visibility span
  attributes.
- `packages/workflows/src/engine.ts`: events recorded to diagnostics; step-graph span attribute.
- `eslint.config.js`: `scope:devtools`, `scope:evals`, `scope:testing`, `scope:devtools-app`
  boundaries.
- `tools/vitest.shared.ts`: aliases for devtools (including `/server`), testing and evals.
- `tsconfig.json`: project references for the new packages and examples.
- `pnpm-workspace.yaml`: `apps/*`. `pnpm-lock.yaml`: new workspace packages.
- `playwright.config.ts`, `tests/browser/project.json`: DevTools demo and app web servers.
- `docs/PROJECT_STATUS.md`, `docs/DECISIONS.md`, `docs/CHANGELOG_PHASES.md`,
  `docs/TECHNICAL_DEBT.md`, `README.md`.
