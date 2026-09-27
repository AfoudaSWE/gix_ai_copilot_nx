# Writing documentation

## Add a page

1. Create `docs/guides/<name>.md` with one `# Title` followed by a one-paragraph summary (used
   as the page description and search snippet).
2. Add an entry to the right section in `apps/docs/src/docs/nav.ts`:
   `guide('<url-slug>', 'Sidebar label', '<file name without .md>', { status: 'beta' })`.
3. Run `pnpm exec nx run docs:test`. It fails when a published file is missing, a guide is not in
   the navigation, or a table-of-contents entry has no matching heading.

## Markdown features

- Link other docs with relative paths (`[Tools](tools.md)`); they become portal routes. Links to
  other repository files open on GitHub. The build fails on a broken relative link.
- `##` and `###` headings get anchors and appear under "On this page".
- Callouts: `> [!NOTE]`, `> [!TIP]`, `> [!WARNING]`, `> [!SECURITY]`, `> [!EXPERIMENTAL]`.
- Code fences take a language and optionally `title="server.ts"` and `{2,4-6}` line highlights.
  Every block gets copy and wrap buttons.
- Tables scroll horizontally on small screens.

## Code that must compile

Put the file in `apps/docs/snippets/`, write `<!-- snippet: file.ts -->` just before the Markdown
block, and keep the block identical to the file. `docs:typecheck` compiles the snippets against
the real packages, and `docs:test` fails if a block drifts from its file.

## Style

Technical, direct and specific. Say what something does and what it refuses to do. Never present
planned work as shipped, and never claim "100% secure". Check every API name against the
generated API reference.
