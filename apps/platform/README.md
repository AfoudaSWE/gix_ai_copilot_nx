# AI Copilot management platform (`apps/platform`)

A React app for configuring and inspecting the AI Copilot ecosystem (**Beta**). It talks only
to the management API (`/management/v1`, served by `apps/api`); it never touches a database,
a model provider or a secret store, and it cannot bypass the management service's
authorization. Lint forbids importing SDK or server packages into its sources.

Sections: Overview, Projects (+ environments), Agents, Models, Tools, OpenAPI, MCP, Knowledge,
Conversations, Prompts, Evaluations, Traces, Security (+ budgets, rate limits), Audit, Users,
Tenants, Usage, Settings (tenant name, write-only secrets). Links a role cannot use are
hidden; the server enforces every role regardless.

```sh
pnpm --filter @gixcopilot/api dev:backend   # development management API on :4102
pnpm --filter @gixcopilot/platform dev      # http://127.0.0.1:5190, proxies /management to :4102
pnpm --filter @gixcopilot/platform build    # static files in web-dist/ (served by the platform container)
```

Run the two commands in separate terminals after `pnpm build`. Sign in with `dev-owner`
for the local in-memory fixtures. To target the configured production API on port 4000,
set `PLATFORM_API_TARGET=http://127.0.0.1:4000` before starting Vite.

Accessibility: landmarks, skip link, `aria-current` navigation, focus moved to each section
heading, labelled forms with polite status regions, tables with captions in scrollable
regions, visible focus, reduced motion, dark mode, RTL toggle, and a phone layout below 760 px.
Costs are always labelled "estimated". Sign-in uses a development bearer token; in production,
put the platform behind your identity provider and authentication proxy.
