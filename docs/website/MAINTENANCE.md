# Maintenance

| When | Do |
| --- | --- |
| A package's public API changes | `pnpm build && node tools/api-reference.mjs`; CI fails on `--check` when it is stale |
| A guide is added or renamed | Update `apps/docs/src/docs/nav.ts`; the tests fail if a guide is unpublished |
| A package's maturity changes | Update the README table, `status` in `nav.ts` and `STATUS` in `tools/api-reference.mjs` |
| An example is added | Add it to `EXAMPLES` in `apps/docs/src/site/pages.tsx` |
| A new integration ships | Add it to the homepage `STRIP` only once it is in the repository |
| The official GIX logo is available | Replace `GixWordmark` and `public/favicon.svg` |
| Dependencies update | Rebuild, run `docs:test` and the website E2E, and check bundle sizes in the build output |

Quality gates in CI: the link check (build), the snippet type-check and drift test, unit and
integration tests, the API reference check, prerendering every route, and Playwright E2E with axe.
