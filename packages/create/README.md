# @gixcopilot/create

Add an AI copilot to your app with one command. It works in an existing **React**, **Vue** or
**Angular** project (or an empty folder), and by default also creates a **Node copilot server**
so your model API key never reaches the browser.

```bash
npm create @gixcopilot@latest
```

Other package managers: `pnpm create @gixcopilot`, `yarn create @gixcopilot`,
`bunx @gixcopilot/create`. Requires Node.js >=22.12.

## What it asks

```text
◆ gixcopilot: AI copilot installer
? Detected Vue in my-shop. Add the Vue copilot? (Y/n)
? Add a Node copilot server (recommended; keeps the model key off the browser)? (Y/n)
? Server folder (copilot-server)
Plan for /projects/my-shop:
  • Install @gixcopilot/vue
  • Add src/copilot/CopilotPanel.vue
  • Proxy /api/copilot to the copilot server (vite.config.ts)
  • Create the Node copilot server in copilot-server/
  • Create copilot-server/.env (add OPENAI_API_KEY there)
  • Install the server's dependencies
  • Add the "copilot:server" script to package.json
? Continue? (Y/n)
```

In an empty folder it first offers to create a React (Vite), Vue (Vite), Angular or server-only
project.

## What you get

| Framework | Installs | Adds |
| --- | --- | --- |
| React | `@gixcopilot/react`, `@gixcopilot/ui` | `src/copilot/CopilotPanel.tsx`, Vite proxy |
| Vue | `@gixcopilot/vue` | `src/copilot/CopilotPanel.vue`, Vite proxy |
| Angular | `@gixcopilot/angular`, `zod` | `src/app/copilot-panel.component.ts`, `proxy.conf.json` + `angular.json` |
| Server (default) | `@gixcopilot/node` and providers | `copilot-server/` (tools, agents, tests), `.env`, `copilot:server` script |

Then:

```bash
npm run copilot:server   # the copilot server on http://127.0.0.1:4000
npm run dev              # your app (Angular: npm start)
```

Render the panel where you want the chat (`<CopilotPanel />`, or `<app-copilot-panel />` in
Angular). Put `OPENAI_API_KEY` in `copilot-server/.env` for real answers; without it a clearly
labelled mock model replies, so everything works offline.

## Options

```text
npm create @gixcopilot@latest [dir] -- [options]

--framework <react|vue|angular|none>  Frontend to integrate (default: detected)
--server / --no-server                 Add the Node copilot server (default: yes)
--server-dir <dir>                     Server folder (default: copilot-server)
--pm <npm|pnpm|yarn|bun>               Package manager (default: detected from the lockfile)
--skip-install                         Write files only
--dry-run                              Show the plan and change nothing
-y, --yes                              Accept all defaults (also used when not in a terminal)
```

Example for CI or scripts: `npm create @gixcopilot@latest -- --yes --framework vue`.

The installer never overwrites existing files. It edits `vite.config.*` only when it has the
plain `defineConfig({ ... })` shape and no `server` section yet; otherwise it prints the line to
add.

## Documentation

- [Getting started](https://github.com/AfoudaSWE/gix_ai_copilot_nx/blob/main/docs/guides/getting-started.md)
- [React](https://github.com/AfoudaSWE/gix_ai_copilot_nx/blob/main/docs/guides/react.md), [Vue](https://github.com/AfoudaSWE/gix_ai_copilot_nx/blob/main/docs/guides/vue.md), [Angular](https://github.com/AfoudaSWE/gix_ai_copilot_nx/blob/main/docs/guides/angular.md), [Node](https://github.com/AfoudaSWE/gix_ai_copilot_nx/blob/main/docs/guides/node.md)
- [Source](https://github.com/AfoudaSWE/gix_ai_copilot_nx/tree/main/packages/create)

## License

MIT
