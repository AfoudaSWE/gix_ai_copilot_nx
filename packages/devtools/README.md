# `@gixcopilot/devtools`

Framework-independent DevTools core. It reads the diagnostics stream that
`@gixcopilot/telemetry`'s recording adapter already captures and projects it into records the
DevTools panels display: runs, messages, context budget, state history, tools and firewall
stages, approvals, RAG and citations, memory, agent tree, delegations and handoffs, workflow
graph, events, traces and errors.

## Use

```ts
import { createRecordingTelemetry } from '@gixcopilot/telemetry';
import { createDevTools, agentTree, workflows, toolTimeline } from '@gixcopilot/devtools';

const telemetry = createRecordingTelemetry({ mode: 'redacted' }); // pass to server/agents/workflows
const devtools = createDevTools({ source: telemetry });

const session = devtools.getSession({ tenantId: 'tenant-a', subject: 'user-1' });
agentTree(session);        // who ran, why, what each agent could see and did
toolTimeline(session);     // tool phases plus the firewall's recorded decision
devtools.exportBundle();   // sanitized debug bundle; importBundle() reads one back as inert data
```

Server transport (optional, subpath export, needs `fastify`):

```ts
import { createDevToolsPlugin } from '@gixcopilot/devtools/server';

app.register(createDevToolsPlugin(devtools, {
  enabled: process.env.DEVTOOLS === '1',
  authorize: (request) => request.headers.authorization === `Bearer ${process.env.DEVTOOLS_TOKEN}`,
  resolveViewer: (request) => ({ tenantId: tenantOf(request) }),
}));
// GET /devtools/session, /devtools/runs/:runId, /devtools/export, /devtools/stream (SSE)
```

## Guarantees

- **Read-only.** Every inspector is a pure function of recorded diagnostics. The security
  inspector shows the Action Firewall's recorded decision; it never evaluates policy.
- **Viewer-scoped.** A viewer with a `tenantId` sees only runs that provably belong to that
  tenant. A viewer with a `subject` never sees another user's memory.
- **Safe by default.** Data is already redacted when recorded. Exports are re-sanitized and
  can never be more permissive than the recording.
- **Locked-down transport.** The plugin is off unless `enabled`, needs `authorize` (or an
  explicit `allowUnauthenticated`), refuses to start under `NODE_ENV=production` without
  `allowInProduction`, and has no route that executes, approves or mutates anything.

## Non-responsibilities

- Does not instrument anything. Runtimes emit through `@gixcopilot/telemetry`; removing
  DevTools changes nothing about execution.
- Does not execute tools, resume workflows, approve actions or roll back state. State
  "time travel" reconstructs recorded values for debugging only.
- Does not replay runs. Safe replay lives in `@gixcopilot/testing`.
- Does not store data durably and is not an audit trail. The Phase 7 audit log remains the
  compliance record.
- Does not render UI. The React app is `apps/devtools`.
