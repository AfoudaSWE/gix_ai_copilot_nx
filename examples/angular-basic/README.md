# Angular basic example

`Angular → @gixcopilot/angular → client → HTTP/SSE → server → model runtime → provider`.

The server uses a **deterministic mock provider** (labelled; no key needed). The app registers
page context (a signal), a frontend tool, shared state exposed to the model and a trusted
generative component, and renders `<aicopilot-chat>`.

```sh
pnpm --filter @gixcopilot/angular-basic build     # server (tsc) + app (ng build)
pnpm --filter @gixcopilot/angular-basic server    # http://127.0.0.1:4319
pnpm --filter @gixcopilot/angular-basic dev       # http://127.0.0.1:4201, proxies /api/copilot
pnpm --filter @gixcopilot/angular-basic test      # real server + real HTTP/SSE + Angular TestBed
```

Measured production bundle (Angular 21, `ng build`): 645 kB raw / 129 kB transferred, of which
zod accounts for ~443 kB raw (zod 4's `z` namespace is not tree-shakable; used by the protocol
and by the app's own schemas) and Angular core ~105 kB. See the Phase 12 performance notes.
