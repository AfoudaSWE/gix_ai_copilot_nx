# React interface lab

Credential-free popup, embedded chat, and sidebar using the real server, client, protocol,
model runtime, and Phase 2 mock provider. Light/dark/system themes, RTL, a slow response,
and a fail-once scenario are selectable. The latter disables automatic runtime retry so
the explicit UI Retry action can be demonstrated.

From the repository root:

```sh
pnpm install
pnpm build
pnpm demo:react
```

Open <http://127.0.0.1:5173>. The companion headless example runs on 5174. The server is
loopback-only on 4318. Vite proxies `/api/copilot/*` to it and removes the prefix. Keep all
three ports available. Stop the foreground command with Ctrl+C.

For separate terminals after build:

```sh
pnpm --filter @gixcopilot/react-basic server
pnpm --filter @gixcopilot/react-basic dev
```

`pnpm --filter @gixcopilot/react-basic test` runs real HTTP/SSE integration tests, including
asserting that Stop aborts the provider's signal. `pnpm test:e2e` builds dependencies and
runs the browser suite. First install Chromium with `pnpm exec playwright install chromium`.

The browser imports no provider/server package. `backend.ts` and `server.ts` are Node-only
entry points; no API keys or production services are required. This is a local development
example, not a deployed service. An actual provider can be configured server-side using
the existing Phase 2 adapter without changing the UI.
