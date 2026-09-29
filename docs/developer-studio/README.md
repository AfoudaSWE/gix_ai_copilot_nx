# Developer Studio

The GIX Developer Studio is a development-only workspace at `/__gix`. It helps you integrate the
copilot into your application:

```text
Install → Initialize → Open /__gix → Configure → Discover → Generate
        → Preview / Diff → Approve → Apply → Validate → Test Copilot
```

Diagnostics are not a step: a health panel stays visible throughout.

> AI proposes. The developer decides. Discovery never writes, generators only produce
> proposals, and only an approved proposal is applied.

## Pages

| Page | What it covers |
| --- | --- |
| [Architecture](ARCHITECTURE.md) | Package layout, the service/HTTP split, the generate/apply boundary |
| [Development vs application plane](DEVELOPMENT_VS_APPLICATION_PLANE.md) | The rule from ADR 0023 and how it is enforced |
| [Configuration](CONFIGURATION.md) | Models, Test Connection, Copilot, Appearance, Security view |
| [Discovery](DISCOVERY.md) | Project, API, component, context, auth/permission and knowledge discovery; re-scan |
| [Generators](GENERATORS.md) | The generator contract and each built-in generator |
| [Proposals, review and apply](PROPOSALS_AND_APPLY.md) | Proposal model, preview/diff, selective approval, apply engine, validation, rollback |
| [Diagnostics](DIAGNOSTICS.md) | What the health panel shows at each stage |
| [Security](SECURITY.md) | Production isolation, API protection, secrets, workspace protection |
| [Troubleshooting](TROUBLESHOOTING.md) | Common problems |

## Quick start

```ts
import { createCopilot } from '@gixcopilot/node';
import { attachStudio } from '@gixcopilot/studio/server';

const copilot = createCopilot({ model, providers, tools, security });
await attachStudio(copilot, { root: process.cwd() }); // registers nothing in production
await copilot.listen({ port: 4000 });
// Open http://localhost:4000/__gix and press Ctrl/⌘ K for commands.
```

Any other Fastify app can use `registerStudio(app, { root })`. The runnable example is
[examples/studio](../../examples/studio).

Generated files land in `.gix/`. Commit them like any other code, and import them from your
copilot server or UI. See the [package README](../../packages/studio/README.md) for all options.

Enhancement tracking: [plan](ENHANCEMENT_PLAN.md), [status](ENHANCEMENT_STATUS.md).
