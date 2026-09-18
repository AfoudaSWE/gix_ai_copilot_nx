---
name: redis-jobs
description: Redis + BullMQ background job standards - retries, idempotency, job status, cancellation, checkpoints, and dead-letter handling. Load when building background/long-running job processing.
---

# Purpose

Define how background and long-running work (e.g. long agent runs, ingestion jobs) is
processed reliably outside the request/response cycle.

# When to Apply

Building or modifying a background job, queue consumer, or any long-running process
managed outside a single HTTP/SSE request lifecycle.

# Required Rules

- Preferred stack: Redis + BullMQ. Do not introduce a second queue/job system without a
  documented reason (see [[dependency-policy]]).
- Every job handler is idempotent: processing the same job twice (due to a retry or an
  at-least-once delivery redelivery) must not double-apply side effects — use a stable job
  key/dedup id for operations with real-world side effects.
- Retries use bounded attempts with backoff; a job that exhausts retries moves to a
  dead-letter queue rather than being silently dropped or retried forever.
- Job status is observable and persisted (queued, active, completed, failed, dead-lettered)
  so a long-running agent run's job state survives a worker restart — see
  [[agent-architecture]]'s resumability requirement.
- Long-running jobs support cancellation: a job in progress can be told to stop and does so
  at a safe checkpoint, not mid-side-effect.
- Long-running jobs checkpoint progress so a restart resumes from the last checkpoint
  instead of restarting the entire job from scratch.
- Job processing is instrumented per [[observability]] (duration, retry count, failure
  reason) with the run/thread correlation id attached.
- Dead-lettered jobs are inspectable (payload, failure history) so a human can diagnose and
  optionally replay them deliberately — not silently discarded.

# Architecture / Patterns

```text
Producer (enqueue job with dedup/idempotency key)
        ↓
BullMQ Queue (Redis-backed)
        ↓
Worker (idempotent handler, checkpointed, cancellable)
        ↓ on exhaustion
Dead-Letter Queue (inspectable, replayable)
```

# Anti-Patterns

- A job handler that re-sends a notification or re-charges a payment on every retry with no
  idempotency key.
- Infinite retry with no backoff and no dead-letter path.
- A long-running agent job whose entire state lives only in the worker process's memory.
- Cancelling a job mid-write with no safe checkpoint, leaving inconsistent state.

# Validation Checklist

- [ ] Job handler is idempotent via a stable dedup/idempotency key
- [ ] Retries are bounded with backoff and feed a dead-letter queue on exhaustion
- [ ] Long-running jobs checkpoint progress and survive a worker restart
- [ ] Jobs support cancellation at a safe checkpoint
- [ ] Job processing is instrumented with correlation ids per [[observability]]
