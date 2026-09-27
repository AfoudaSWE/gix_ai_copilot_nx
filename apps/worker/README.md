# Background worker (`apps/worker`)

Processes serializable BullMQ jobs (**Beta**). Run as many replicas as you need; each job runs
once (stable job ids, retained for deduplication), transient failures retry with backoff, and
permanent failures go to the dead-letter queue.

| Job | What it does |
| --- | --- |
| `knowledge.index` | Loads a URL knowledge source from the control plane, then chunks, embeds and indexes it into pgvector under the source's tenant and ACL. Enqueued by the platform's "Reindex". |
| `maintenance.memory-expiry` | Deletes expired memory records. |
| `maintenance.retention` | Applies configured retention: conversations, usage, audit (via the audited purge path). |
| yours | `createWorker({ config, handlers: { 'workflow.resume': ..., 'eval.run': ... } })` |

Maintenance is enqueued once per day with the date as idempotency key, so several workers
never double-run it. On SIGTERM the worker stops taking jobs, waits for active ones up to the
grace period, then aborts the rest; BullMQ retries those elsewhere, which is why handlers must
be idempotent.
