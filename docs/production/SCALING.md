# Scaling

- **API**: durable conversation, approval, audit, usage and configuration state lives in
  PostgreSQL; rate limits are shared in Redis. Instances can serve independent runs behind a
  load balancer. A live run registry and frontend tool bridge remain process-local: route
  cancel and frontend tool-result requests for a run to its originating instance (for
  example, with affinity at the edge). An instance loss ends its active streams. Approval
  decisions may reach any instance because the approval store is durable and polled. With
  two or more instances, affinity is required: see
  [Running more than one API instance](#running-more-than-one-api-instance).
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

## Running more than one API instance

Session affinity at the edge is **required** once you run two or more API instances.

| Request                          | Must reach                   | Why                                    |
| -------------------------------- | ---------------------------- | -------------------------------------- |
| `POST /runs`                     | any instance                 | starts the run on that instance        |
| `POST /runs/:runId/cancel`       | the instance that started it | the live run registry is in-process    |
| `POST /runs/:runId/tool-results` | the instance that started it | the frontend tool bridge is in-process |
| `/approvals/*`, `/management/*`  | any instance                 | backed by PostgreSQL                   |

The run id is assigned by the instance that serves `POST /runs`, so the edge cannot route by
run id alone. Pin each client to one instance with an affinity cookie instead:

- **nginx (open source):** see
  [`deploy/docker/api-affinity.nginx.conf.example`](../../deploy/docker/api-affinity.nginx.conf.example).
- **Kubernetes ingress-nginx:** `nginx.ingress.kubernetes.io/affinity: "cookie"` plus
  `nginx.ingress.kubernetes.io/session-cookie-name: "gix_api_affinity"`.
- **AWS ALB / GCP / Azure load balancers:** enable their load-balancer-generated cookie
  stickiness on the API target group.

Without affinity, a cancel or a frontend tool result that lands on another instance is
answered `404` (unknown run), and the run continues or waits until its own timeout. The
browser client sends cookies on same-origin requests by default; server-to-server callers must
send the affinity cookie back themselves, or call a single instance directly.

Also use the shared stores rather than the in-memory defaults when running several instances:
`createPostgresApprovalStore` and `createPostgresAuditSink` from `@gixcopilot/persistence-postgres`,
and `createRedisRateLimiter` from `@gixcopilot/redis`. The in-memory versions are per process.
