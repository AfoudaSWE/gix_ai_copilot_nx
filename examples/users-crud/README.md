# Users CRUD example

A React and NestJS users directory with a copilot. The copilot manages users through
`@gixcopilot/connectors`: the REST endpoints are declared once in
[`api/users.connector.ts`](api/users.connector.ts) and become the tools `users.list`, `users.get`,
`users.create`, `users.update` and `users.delete`, which call the same API the web form uses.

## Run

From the repository root:

```sh
pnpm install
pnpm --filter @gixcopilot/users-crud build
pnpm --filter @gixcopilot/users-crud server
```

In another terminal:

```sh
pnpm --filter @gixcopilot/users-crud dev
```

Open `http://127.0.0.1:5178`. The Vite server proxies `/api` to NestJS on `127.0.0.1:4319` and
`/api/copilot` to the copilot runtime on `127.0.0.1:4325` (set `PORT` / `COPILOT_PORT` to change
them). Both run in the `server` process.

The API implements `GET /api/users`, `GET /api/users/:id`, `POST /api/users`, `PATCH /api/users/:id`, and `DELETE /api/users/:id`. User data is stored in `data/users.json` relative to the server's working directory. Set `USERS_DATA_FILE` to use another location. The file is created on the first mutation. This file store is intended for a single local API process.

## Copilot

Set `OPENAI_API_KEY` in `examples/users-crud/.env` (and optionally `OPENAI_MODEL`, default
`gpt-4o-mini`) before starting the server. The `server` script loads this file. Without a key,
the copilot uses a mock provider that only says a key is needed. Restart the server after
changing `.env`.

Set `OPENAI_MODEL` to an OpenAI model ID. The value `auto` uses this example's default
`gpt-4o-mini` model.

- Every tool call passes the Action Firewall and requires the `api.users` permission.
- Reads run straight away; `create`, `update` and `delete` wait for you to confirm in the chat.
- The table reloads after each copilot run, and the user open in the edit form is shared with the
  copilot as context.
- The browser identifies itself with the fixed token `users-crud-local-dev`, a local development
  fixture (like the unauthenticated REST API itself). A real app sends its own session token and
  replaces `createStaticAuthenticationAdapter` in [`api/copilot.ts`](api/copilot.ts).

## Checks

```sh
pnpm --filter @gixcopilot/users-crud typecheck
pnpm --filter @gixcopilot/users-crud lint
pnpm --filter @gixcopilot/users-crud test
pnpm --filter @gixcopilot/users-crud build
```
