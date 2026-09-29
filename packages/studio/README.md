# `@gixcopilot/studio`

> **Status:** Experimental. Development-only. See [stability levels](https://github.com/AfoudaSWE/gix_ai_copilot_nx/blob/main/docs/VERSIONING.md#stability-levels).

The GIX Developer Studio: a development-time control plane served at `/__gix`. It discovers
your project read-only, turns what it finds into **proposals** (tools, context, generative UI,
security policies, agents, skills, knowledge, configuration), shows a preview and diff, and
writes files only after you approve.

> AI proposes. The developer decides.

## Install

```bash
npm install -D @gixcopilot/studio typescript
```

Requires Node.js >=22.12.0. ESM only. `typescript` is an optional peer used for source analysis;
without it, discovery reports `AST_UNAVAILABLE` and skips API, component, context and
permission analysis. `fastify` is needed for the `./server` entry.

## Use

```ts
import Fastify from 'fastify';
import { registerStudio } from '@gixcopilot/studio/server';
import { createOpenAIProvider } from '@gixcopilot/provider-openai';

const app = Fastify();
await registerStudio(app, {
  root: process.cwd(),
  model: { provider: 'openai', model: 'gpt-4o-mini' },
  // The Studio hands the session key (if any) to your existing provider adapter.
  providers: { openai: (settings) => createOpenAIProvider({ apiKey: settings.apiKey, baseURL: settings.baseUrl }) },
  keyEnvironment: { openai: 'OPENAI_API_KEY' },
  facts: () => ({ runtime: true, server: true, firewall: true, devtools: false }),
});
await app.listen({ port: 4000 });
// open http://localhost:4000/__gix
```

With `NODE_ENV=production`, `registerStudio` returns `undefined` and registers nothing:
`/__gix` and `/__gix/api/*` are 404.

With `createCopilot` from `@gixcopilot/node`, attach the Studio to the copilot itself, before
`listen()`. The Studio then uses the copilot's model runtime for Test Connection, its tool
registry for the Security view and diagnostics, and its routes for the live preview. At startup
it fails if an application tool uses a development-plane name.

```ts
import { createCopilot } from '@gixcopilot/node';
import { attachStudio } from '@gixcopilot/studio/server';

const copilot = createCopilot({ model, providers, tools, security });
await attachStudio(copilot, { root: process.cwd() }); // undefined in production
await copilot.listen({ port: 4000 });
```

A runnable version is in [examples/studio](../../examples/studio).

The framework-independent core works without HTTP:

```ts
import { createStudioService } from '@gixcopilot/studio';

const studio = createStudioService({ root: process.cwd() });
await studio.discover();
const proposal = await studio.generate('api-tools');       // writes nothing
await studio.approve(proposal.id, [proposal.tools[0].id]); // selective approval
await studio.apply(proposal.id);                            // writes .gix/*, then validates
```

## Public API

- Planes: `assertApplicationPlane`, `isDevelopmentToolName`, `DEVELOPMENT_CAPABILITIES`.
- Workspace: `createReadonlyWorkspace`, `createWorkspaceGuard`, `isSecretPath`.
- Discovery: `discoverProject`, `compareDiscoveries`, `DEFAULT_DETECTORS`, `ProjectDetector`.
- Generators: the `Generator` contract, `runGenerator`, and the built-in generators
  (`api-tools`, `openapi-tools`, `state-context`, `components-ui`, `auth-security`,
  `project-agents`, `project-skills`, `docs-knowledge`, `studio-configuration`).
- Proposals: `ChangeProposal`, `applyEdits`, `reviewProposalSecurity`.
- Apply: `createApplyEngine`, `scanForSecrets`, `unifiedDiff`.
- Service: `createStudioService`. Server (`./server`): `registerStudio`, `attachStudio`, `studioPlugin`.

## Non-responsibilities

- It is not an application copilot capability. Nothing here is registered as a tool, agent or
  skill for end users (ADR 0023).
- It does not run in production, and there is no override.
- It does not register generated code. Generated files live under `.gix/`, and your application
  imports them explicitly.
- It does not index knowledge, persist API keys, or call a model provider from the browser.
- It does not modify the project on install. `npx gixcopilot init` changes are out of scope.

See [docs/developer-studio](../../docs/developer-studio/README.md).
