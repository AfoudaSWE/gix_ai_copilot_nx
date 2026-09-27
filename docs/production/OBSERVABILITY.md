# Observability

| Signal | How |
| --- | --- |
| Traces | `@gixcopilot/telemetry` → OpenTelemetry API. Register an OTel SDK and exporter in your process (the SDK does not bundle a vendor). Ratio head sampling via `AICOPILOT_TRACE_SAMPLE_RATIO`. |
| Metrics | `/metrics` (Prometheus text, opt-in, bearer token): `copilot_runs_total{status}`, `copilot_active_runs`, `copilot_tokens_total{direction,model}`, `copilot_run_duration_seconds_{sum,count}`, `copilot_tool_calls_total{outcome}`, process memory and uptime. No tenant, user or prompt labels. |
| Logs | JSON lines (pino via Fastify): `time`, `level`, `service`, `environment`, request id, message, error; `authorization`, `cookie` and API-key headers are redacted. Correlate with run ids from protocol events. |
| Diagnostics | Redacted recording (DevTools projections) per API instance for the platform's Traces view; bounded ring buffer, not durable. |
| Audit | Separate from traces: durable, append-only, searchable per tenant in the platform. |
| Usage | `usage_events` (tokens, requests, tools, agents, workflows, RAG, embeddings) with estimated cost. |

Health: `/health` (liveness) and `/ready` (dependencies and migrations). Alert on sustained
`/ready` failures, `copilot_runs_total{status="failed"}` rate, dead-lettered jobs, and budget
warnings (the usage admission `onWarning` hook).
