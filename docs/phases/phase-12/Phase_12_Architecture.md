# Phase 12 architecture

The production API (`apps/api`) composes the Phase 1–11 server, Action Firewall, model runtime and telemetry with the Phase 12 tenancy, persistence, Redis, routing and usage adapters. `apps/worker` runs durable jobs separately. The management API (`@gixcopilot/management`) owns versioned configuration; `apps/platform` is an HTTP client of that API. The runtime uses a validated snapshot so temporary management failure does not interrupt existing configuration.

Browser packages remain independent of server packages. React and Angular share `@gixcopilot/headless`; the Node SDK calls the same server routes. See [ADR 0020](../../adr/0020-production-runtime-and-control-plane.md) and [ADR 0021](../../adr/0021-model-fallback-and-usage-enforcement.md).
