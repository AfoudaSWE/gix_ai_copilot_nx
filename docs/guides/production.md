# Production

```text
            Load balancer
          ┌──────┴──────┐
      API server    API server        (stateless: apps/api)
          └──────┬──────┘
   ┌─────────────┼──────────────┐
PostgreSQL     Redis       OTel collector
 (+pgvector)     │
               BullMQ ──▶ worker · worker   (apps/worker)
Platform (static + nginx) ──▶ /management/v1 on the API
```

| Topic | Read |
| --- | --- |
| Configuration, environments, secrets | [CONFIGURATION](../production/CONFIGURATION.md) |
| Deploying (containers, compose, sequencing) | [DEPLOYMENT](../production/DEPLOYMENT.md) |
| PostgreSQL, migrations, indexes, pgvector | [DATABASE](../production/DATABASE.md) |
| Redis, rate limits, locks | [REDIS](../production/REDIS.md), [RATE_LIMITING](../production/RATE_LIMITING.md) |
| Background jobs | [WORKERS](../production/WORKERS.md) |
| Scaling | [SCALING](../production/SCALING.md) |
| Security and tenants | [SECURITY](../production/SECURITY.md), [Multi-tenancy](multi-tenancy.md) |
| Observability | [OBSERVABILITY](../production/OBSERVABILITY.md) |
| Usage, cost, budgets, quotas | [USAGE_AND_COST](../production/USAGE_AND_COST.md) |
| Backups, recovery, retention, deletion | [BACKUP_RECOVERY](../production/BACKUP_RECOVERY.md) |
| Day-2 operations | [OPERATIONS](../production/OPERATIONS.md) |

Control plane vs data plane: the API serves user traffic from resolved configuration
snapshots. If the platform or management API is unavailable, runs keep the last good
snapshot. An admin edit applies to the next run, never to one in flight.
