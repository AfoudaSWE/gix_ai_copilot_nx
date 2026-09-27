# @gixcopilot/checkpoint-postgres

PostgreSQL (Drizzle + `pg`) implementation of the `CheckpointStore` port from
`@gixcopilot/workflows`, so workflow runs survive process restarts and can be resumed by any
server or worker instance.

```sh
pnpm add @gixcopilot/checkpoint-postgres pg
```

```ts
import { createPgCheckpointStore } from '@gixcopilot/checkpoint-postgres';

const checkpoints = createPgCheckpointStore({ connectionString: process.env.DATABASE_URL });
```

Exports `createPgCheckpointStore` and the Drizzle table `workflowRuns`. The table is created by
the SQL in `migrations/` (shipped with the package), applied by the reviewed migration process
(`aicopilot db migrate`), never implicitly at startup; see [docs/production/DATABASE.md](../../docs/production/DATABASE.md). Server-only.

## Documentation

- [workflows guide](https://github.com/AfoudaSWE/gix_ai_copilot_nx/blob/main/docs/guides/workflows.md)
- [Getting started](https://github.com/AfoudaSWE/gix_ai_copilot_nx/blob/main/docs/guides/getting-started.md)
- [Source](https://github.com/AfoudaSWE/gix_ai_copilot_nx/tree/main/packages/checkpoint-postgres)

## License

MIT
