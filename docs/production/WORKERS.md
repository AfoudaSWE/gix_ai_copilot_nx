# Workers

```text
API / platform ──enqueue(kind, payload, idempotencyKey)──▶ BullMQ (Redis) ──▶ worker ──▶ PostgreSQL
```

- **Jobs are serializable**: a kind plus JSON payload plus the tenant the producer
  authenticated. Handlers live in the worker process (`apps/worker`); applications add their
  own (`workflow.resume`, `eval.run`, custom ingestion).
- **Idempotency**: the job id is `kind + idempotencyKey`, and completed jobs are kept 24 h, so
  duplicate enqueues (retries, double clicks, redelivery) resolve to the same job. Handlers
  are idempotent too: re-indexing replaces a document partition, and purges delete "older
  than".
- **Retries**: bounded attempts (default 3) with exponential backoff.
- **Dead letters**: permanent errors (`PermanentJobError`, non-retryable SDK errors) and
  unknown kinds skip retries; exhausted jobs also land in the failed set. Inspect or replay
  them deliberately with `createDeadLetterInspector`. Nothing retries forever.
- **Cancellation**: each handler receives an `AbortSignal` (`worker.cancel(jobId)`, or on
  shutdown).
- **Graceful shutdown**: stop taking jobs, wait up to the grace period, abort stragglers
  (BullMQ retries them elsewhere), close queue and pool.
- **Built-in jobs**: `knowledge.index` (URL sources from the platform → chunk → embed → pgvector
  under the source's tenant and ACL), `maintenance.memory-expiry`, `maintenance.retention`.
  Maintenance is enqueued daily with the date as key, so N workers run it once.

Durable workflows keep their state in PostgreSQL checkpoints. A crashed worker loses no
workflow; resuming from the checkpoint continues the run.
