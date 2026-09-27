# ADR 0020: Production runtime and control plane

Status: Accepted for Phase 12

## Context

The SDK runtime must keep serving authenticated runs when management services are unavailable. Configuration and data must remain scoped to a tenant, project and environment. Framework clients must not gain direct access to persistence or secrets.

## Decision

- Keep the data plane in `apps/api`, built from the existing server, model, security and telemetry packages. Put management operations behind the authenticated `/management/v1` API; the platform uses that API only.
- Derive tenant scope from trusted authentication. Repositories expose tenant-bound operations, and the PostgreSQL schema indexes tenant identifiers. A request body or model response cannot choose its own tenant.
- Persist control-plane resource versions and encrypted secret values in PostgreSQL. Publish a validated configuration snapshot to the runtime and retain the last valid snapshot through a transient control-plane failure.
- Run schema migrations as a separate deployment step under an advisory lock. API instances and workers do not migrate on startup.
- Keep browser adapters dependent on neutral packages only. Angular and React share headless chat behavior; Node uses the existing HTTP/server execution path.

## Consequences

The runtime can continue with its last valid configuration during a management outage. Changes in management may take a bounded cache interval to appear. Operators must deploy migrations before API and worker processes and must provide durable PostgreSQL, Redis and secrets.

This does not make the platform UI an authority: management authorization, tenant checks, tool policy and the Action Firewall remain server-side.
