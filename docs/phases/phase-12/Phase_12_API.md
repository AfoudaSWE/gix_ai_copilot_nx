# Phase 12 public API

The generated [package reference](../../reference/api.md) is the declaration-level API inventory. Primary entries are `provideCopilot` and `CopilotService` in `@gixcopilot/angular`, `createCopilot` in `@gixcopilot/node`, `aicopilot` in `@gixcopilot/cli`, `createApiServer` in `apps/api`, and the versioned `/management/v1` HTTP resources in `@gixcopilot/management`.

Configuration, tenancy, routing, usage and infrastructure adapters expose package-local interfaces through their package root. Apps are deployment targets, not npm SDK packages.
