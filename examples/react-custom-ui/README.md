# React custom UI

Demonstrates `useCopilotChat()` without a dependency on `@gixcopilot/ui`. All markup, plain
text rendering, inputs, and CSS belong to this application. It supports send, stop, retry,
regenerate, clear, and status. There is no Markdown dependency here.

Run `pnpm install`, `pnpm build`, then `pnpm demo:react` from the repository root and open
<http://127.0.0.1:5174>. It uses the same loopback mock backend on 4318 as react-basic.
Alternatively start `pnpm --filter @gixcopilot/react-basic server` and
`pnpm --filter @gixcopilot/react-custom-ui dev` in separate terminals after building.

The package's SSR test checks that its initial render works without browser globals or
network access. The shared Playwright suite sends, stops, and clears through this custom
interface. This example deliberately renders model content as text; use the safe UI
Markdown component only if your own application needs it.
