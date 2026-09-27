# Search

- Open search with **Ctrl/Cmd + K**, **/**, or the header search button. Arrow keys move, Enter
  opens, Esc closes. Results are grouped by docs section, API Reference, CLI and Website.
- The index is built at build time by the `virtual:gix-search-index` module in
  `apps/docs/vite.config.ts`, using `buildSearchIndex()` from `src/docs/search-core.ts`. It holds
  page titles and summaries, every H2/H3 section with its text, every package and exported symbol
  with its signature, and the CLI commands.
- The index is a separate chunk (about 56 kB gzipped) that loads only when search first opens.
- Ranking (`searchIndex()`): every term must match. Exact and prefix title matches rank first,
  then word-start matches; pages rank slightly above sections and API symbols.
- Tests: `src/ui.spec.tsx` (ranking and keyboard) and `tests/browser/website.spec.ts` (end to end
  with axe).
