# Phase 11 handoff

## Run from the workspace root

```sh
pnpm install
pnpm validate                                              # lint + typecheck + test + build
npx playwright test                                        # browser suite, including DevTools
```

## DevTools

```sh
SEED_SCENARIO=1 pnpm --filter @gixcopilot/devtools-demo start   # host on :4100, DevTools token local-dev-token
pnpm --filter @gixcopilot/devtools-app dev                      # UI on :5180; enter the token, Connect
pnpm --filter @gixcopilot/devtools-demo trace                   # output/trace-bundle.json, import it in the UI
```

## Evals

```sh
pnpm --filter @gixcopilot/evals-demo eval                                   # deterministic, CI gate
MODEL_PROVIDER=openai OPENAI_API_KEY=sk-... pnpm --filter @gixcopilot/evals-demo eval
EVAL_REGRESSION_DEMO=1 pnpm --filter @gixcopilot/evals-demo eval            # shows the gate failing
```

## Adding observability to an application

```ts
import { composeTelemetry, createOpenTelemetryAdapter, createRecordingTelemetry } from '@gixcopilot/telemetry';

const recording = createRecordingTelemetry({ mode: 'redacted' });           // for DevTools (development)
const telemetry = composeTelemetry([createOpenTelemetryAdapter(), recording]);
const app = createServer({ ..., telemetry });                               // also: agents/workflow engines accept `telemetry`
```

Wrap the other seams your host owns: `instrumentContextEngine`, `createRetrieverTelemetry`,
`instrumentMemoryService`, `observeStateStore`, `instrumentApprovalStore`. Then expose DevTools
in development only:

```ts
import { createDevTools } from '@gixcopilot/devtools';
import { createDevToolsPlugin } from '@gixcopilot/devtools/server';
await app.register(createDevToolsPlugin(createDevTools({ source: recording }), {
  enabled: process.env.NODE_ENV !== 'production',
  authorize: (request) => request.headers.authorization === `Bearer ${process.env.DEVTOOLS_TOKEN}`,
  resolveViewer: (request) => ({ tenantId: tenantOf(request) }),
}));
```

In production, use `createOpenTelemetryAdapter` with your OTLP exporter and `createRatioSampler`
for spans, and leave DevTools disabled.

## Writing tests

Use `createCopilotTestHarness` for end-to-end behavior, and `createAgentSimulation` or
`createWorkflowSimulation` for orchestration. Classify tools with `security.risk` as production
code must: unclassified tools fail closed to approval. Assert on the firewall's decision with
`expectActionDenied` / `expectApprovalRequired`, never on the model's wording.

## Writing evals

Build the real app inside the target, pass it the runner's `telemetry`, return the answer. Put
adversarial cases in the dataset with `forbiddenTools`, `forbiddenSources`, `forbiddenAgents`
and `memory.allowedOwners`; the security gate is automatic. Store runs with
`createFileEvalStore` and compare to a baseline in CI.

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| DevTools shows no agent tree | The agent runtime was not given the recording `telemetry` |
| Token metrics show `[REDACTED]` | Telemetry built before this phase's redaction fix; rebuild |
| A delegated agent sees no tools, knowledge or memory | Least privilege: the delegator must declare the ceiling (Phase 10) |
| Raw view is disabled | The session was recorded in `redacted` or `metadata-only` mode |
| `ReplayNotPossibleError` | The recording has no payloads (`metadata-only`); use `mode: 'mocked'` |
| Plugin throws at startup | Missing `authorize`, or `NODE_ENV=production` without `allowInProduction` |
| A mock tool call stays `pending` | The tool runtime timed out the call; see the timeout limit in Issues |
