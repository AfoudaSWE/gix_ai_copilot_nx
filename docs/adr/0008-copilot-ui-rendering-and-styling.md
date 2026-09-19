# 0008 — Copilot UI Rendering and Styling

## Status

Accepted (Phase 3).

## Decision

- Ship an explicit `@gixcopilot/ui/styles.css` export with prefixed selectors and semantic
  CSS variables. Mark CSS side-effectful while leaving ESM JavaScript tree-shakeable.
  No Tailwind build/configuration is required in a consumer.
- Use a quiet ink/blue palette, clear typography, and native controls. Light/dark/system
  themes and logical CSS properties let hosts choose theme and reading direction.
- Popup uses a native modal dialog plus explicit Tab wrapping for focus containment and host inertness; sidebar is
  nonmodal and in-flow. Both support controlled/uncontrolled visibility, Escape and focus
  restoration. Native dialog support is the browser floor.
- `components` slots consistently customize Header/UserMessage/AssistantMessage/Input/
  EmptyState. Rendering boundaries contain failures and notify `onRenderError` or console.
- Use `react-markdown` + `remark-gfm` for maintained AST-to-React Markdown and GFM tables.
  Raw HTML, remote images and form controls are disabled. A URL allow policy rejects
  executable schemes; links open safely with `noopener noreferrer`. No HTML injection,
  syntax-highlighter, generated component execution, or model-chosen plugins.
- Keep code readable as literal text with a language label, copy feedback and horizontal
  scrolling. Clipboard failures are recoverable. Do not add a large syntax engine.
- Announce generation phases and completed text in one polite region. The transcript's
  automatic announcements are disabled to avoid reading every delta.
- Scroll follows new text only near the bottom; a jump control lets readers resume.
- Use the two real examples as the Phase 3 workbench. Storybook would duplicate setup and
  add maintenance with little benefit at this phase. Attachment transport does not exist,
  so no misleading attachment control is shown.

## Dependency tradeoff

Browsers do not provide a safe Markdown parser. Implementing our own would create a larger
security and compatibility burden. The unified/remark projects are established maintained
packages; their runtime cost is isolated in UI. Full-export measurements: React adapter
5,874 bytes minified / 1,922 gzip; UI including Markdown/GFM 233,364 / 57,502. React and
workspace dependencies are external in those measurements; see `tools/measure-react.mjs`.
These are initial measurements, not before/after improvement claims. The full demo bundles
are larger because they include React DOM and the existing client/protocol validation.

Production dependency audit reported zero advisories during this session. That is a
point-in-time registry result, not a blanket safety guarantee. Custom renderers are trusted
host code and remain responsible for safe rendering.

Reference: [react-markdown security and architecture](https://github.com/remarkjs/react-markdown).
