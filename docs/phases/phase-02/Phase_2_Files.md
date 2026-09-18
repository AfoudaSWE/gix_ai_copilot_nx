# Phase 2 Files

Exact `git status` output at Phase 2 completion (A = added, M = modified).

## Added

```text
docs/DECISIONS.md
docs/PROJECT_STATUS.md
docs/TECHNICAL_DEBT.md
docs/adr/0006-model-provider-abstraction.md
docs/phases/phase-02/Phase_2_API.md
docs/phases/phase-02/Phase_2_Architecture.md
docs/phases/phase-02/Phase_2_Decisions.md
docs/phases/phase-02/Phase_2_Docs.md
docs/phases/phase-02/Phase_2_Files.md
docs/phases/phase-02/Phase_2_Handoff.md
docs/phases/phase-02/Phase_2_Implementation.md
docs/phases/phase-02/Phase_2_Issues.md
docs/phases/phase-02/Phase_2_Status.md
docs/phases/phase-02/Phase_2_Testing.md
examples/model-streaming/README.md
examples/model-streaming/package.json
examples/model-streaming/project.json
examples/model-streaming/src/integration.spec.ts
examples/model-streaming/src/main.ts
examples/model-streaming/src/openai-smoke.spec.ts
examples/model-streaming/tsconfig.json
examples/model-streaming/vitest.config.ts
packages/protocol/src/finish-reason.ts
packages/providers/mock/README.md
packages/providers/mock/package.json
packages/providers/mock/project.json
packages/providers/mock/src/index.ts
packages/providers/mock/src/mock-provider.spec.ts
packages/providers/mock/src/mock-provider.ts
packages/providers/mock/tsconfig.json
packages/providers/mock/vitest.config.ts
packages/providers/openai/README.md
packages/providers/openai/package.json
packages/providers/openai/project.json
packages/providers/openai/src/error-mapping.ts
packages/providers/openai/src/index.ts
packages/providers/openai/src/message-mapping.ts
packages/providers/openai/src/openai-provider.spec.ts
packages/providers/openai/src/openai-provider.ts
packages/providers/openai/tsconfig.json
packages/providers/openai/vitest.config.ts
packages/providers/provider-core/README.md
packages/providers/provider-core/package.json
packages/providers/provider-core/project.json
packages/providers/provider-core/src/index.ts
packages/providers/provider-core/src/latency.ts
packages/providers/provider-core/src/model-executor.spec.ts
packages/providers/provider-core/src/model-executor.ts
packages/providers/provider-core/src/model-message.ts
packages/providers/provider-core/src/model-provider.ts
packages/providers/provider-core/src/model-reference.ts
packages/providers/provider-core/src/model-request.ts
packages/providers/provider-core/src/model-runtime.spec.ts
packages/providers/provider-core/src/model-runtime.ts
packages/providers/provider-core/src/model-stream-event.ts
packages/providers/provider-core/src/registry.spec.ts
packages/providers/provider-core/src/registry.ts
packages/providers/provider-core/src/retry.spec.ts
packages/providers/provider-core/src/retry.ts
packages/providers/provider-core/src/telemetry.ts
packages/providers/provider-core/tsconfig.json
packages/providers/provider-core/vitest.config.ts
```

## Modified

```text
docs/architecture/overview.md
eslint.config.js
examples/protocol-demo/src/integration.spec.ts        (messages rename only)
examples/protocol-demo/src/main.ts                     (messages rename only)
packages/client/README.md
packages/client/src/client.spec.ts
packages/client/src/client.ts
packages/client/src/index.ts
packages/client/src/sse-transport.spec.ts
packages/client/src/sse-transport.ts
packages/client/src/transport.ts
packages/core/README.md
packages/core/src/cancellable-iteration.ts
packages/core/src/echo-executor.spec.ts
packages/core/src/echo-executor.ts
packages/core/src/executor.ts
packages/core/src/index.ts
packages/core/src/runtime.spec.ts
packages/core/src/runtime.ts
packages/protocol/README.md
packages/protocol/src/errors.spec.ts
packages/protocol/src/errors.ts
packages/protocol/src/events.ts
packages/protocol/src/index.ts
packages/protocol/src/serialization.spec.ts
packages/protocol/src/serialization.ts
packages/server/README.md
packages/server/package.json
packages/server/project.json
packages/server/src/app.spec.ts
packages/server/src/app.ts
packages/server/src/schemas.ts
packages/server/tsconfig.json
pnpm-lock.yaml
pnpm-workspace.yaml
tools/vitest.shared.ts
tsconfig.json
```

3 new packages (`provider`, `provider-mock`, `provider-openai`), 1 new example
(`model-streaming-demo`), 60 files added, 34 files modified.
