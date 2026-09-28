# @gixcopilot/jobs

> **Status:** Beta. See [stability levels](https://github.com/AfoudaSWE/gix_ai_copilot_nx/blob/main/docs/VERSIONING.md#stability-levels).

BullMQ (Redis) implementation of the workflow `JobExecutor` port, plus dead-letter inspection.
Workflow steps become queue jobs with stable ids, so duplicate delivery does not double-apply a
step; exhausted or permanently failing jobs move to an inspectable dead-letter queue.

```sh
pnpm add @gixcopilot/jobs bullmq
```

| Export | Purpose |
| --- | --- |
| `createBullMQJobExecutor` | Queue + worker executor for workflow steps |
| `createDeadLetterInspector` | List and deliberately replay dead-lettered jobs |

Redis is used for delivery, not as the source of truth: checkpoints live in PostgreSQL
(`@gixcopilot/checkpoint-postgres`). See [docs/production/WORKERS.md](../../docs/production/WORKERS.md). Server-only.

## Documentation

- [workflows guide](https://github.com/AfoudaSWE/gix_ai_copilot_nx/blob/main/docs/guides/workflows.md)
- [Getting started](https://github.com/AfoudaSWE/gix_ai_copilot_nx/blob/main/docs/guides/getting-started.md)
- [Source](https://github.com/AfoudaSWE/gix_ai_copilot_nx/tree/main/packages/jobs)

## License

MIT
