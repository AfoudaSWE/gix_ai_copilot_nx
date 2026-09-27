# Scaling

- **API**: durable conversation, approval, audit, usage and configuration state lives in
  PostgreSQL; rate limits are shared in Redis. Instances can serve independent runs behind a
  load balancer. A live run registry and frontend tool bridge remain process-local: route
  cancel and frontend tool-result requests for a run to its originating instance (for
  example, with affinity at the edge). An instance loss ends its active streams. Approval
  decisions may reach any instance because the approval store is durable and polled.
- **Streaming connections**: each run holds one HTTP response open. Size load-balancer idle
  timeouts above your longest expected run and prefer HTTP/1.1 keep-alive or HTTP/2 at the
  edge. See [Phase 12 Testing](../phases/phase-12/Phase_12_Testing.md) for measured concurrent
  stream numbers on the reference machine; they are not universal benchmarks.
- **Workers**: scale on queue depth; BullMQ guarantees one active consumer per job.
- **Database**: pool size per process (`DATABASE_POOL_MAX`, default 10). Keep instances ×
  pool below the server's connection limit, or use a pooler (PgBouncer transaction mode is
  fine; the migrator uses an advisory lock on its own connection).
- **Caching**: configuration snapshots are cached 15 s per tenant scope with last-good
  fallback. Nothing else is cached without a measured need.
- **Telemetry**: the in-memory recording used for platform traces is per instance and
  bounded (ring buffer); export to an OpenTelemetry backend for fleet-wide traces.
