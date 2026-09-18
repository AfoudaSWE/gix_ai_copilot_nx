# Phase 1 Decisions

The full reasoning for each of these lives in the named ADR; this file is a short index of
what was decided and why, for anyone who wants the summary without opening every ADR.

1. **Nx + pnpm monorepo, hand-written `project.json` targets.** No heavy target-inference
   plugin stack (`@nx/js`, `@nx/vite`, ...) — every target's exact command is inspectable in
   the package's own `package.json`. See
   [ADR 0001](../../adr/0001-monorepo-and-package-boundaries.md).

2. **`@gixcopilot/core` depends only on `@gixcopilot/protocol`.** The generic `Executor`
   boundary — not a hardcoded model concept — is where anything else (a real model, in
   Phase 2) attaches. See [ADR 0002](../../adr/0002-framework-independent-core.md).

3. **The protocol is a discriminated-union `CopilotEvent`, not a request/response RPC
   shape**, with sequence-based ordering, an explicit `protocolVersion`, and three-way
   known/unknown/invalid event classification for forward compatibility. See
   [ADR 0003](../../adr/0003-event-driven-protocol.md).

4. **SSE (not WebSocket), with run creation and streaming combined into one request.** A
   real bug — listening for client disconnect on the wrong stream, which cancelled every
   run almost immediately — was found and fixed during this phase's own validation. See
   [ADR 0004](../../adr/0004-sse-as-initial-streaming-transport.md) and
   `Phase_1_Issues.md`.

5. **ESM-only, NodeNext `.js`-extension imports, TypeScript project references (not
   path-alias-to-source), `tsc -b` for both `build` and `typecheck`.** A `paths`-based
   alias approach was tried first and rejected after hitting a `rootDir` conflict. See
   [ADR 0005](../../adr/0005-module-resolution-and-build-strategy.md).

6. **IDs are plain `string` type aliases, not nominally-branded types.** Branding was
   considered (to stop a `RunId` being passed where a `ThreadId` is expected) but dropped:
   it fought the Zod schemas that validate ids as plain strings, for no real benefit at this
   scale — see the comment in `packages/protocol/src/ids.ts`.

7. **`createEchoExecutor` is a deliberately non-AI reference implementation**, not a
   template for a real model — it exists solely so the architecture could be proven end to
   end without any provider dependency, and so `@gixcopilot/core`'s own test suite needs no
   network access.
