# Phase 3 Issues and Limits

## Found and fixed

1. **Snapshot union narrowing.** The initial idle snapshot narrowed a mutable store variable
   too far for later error states. An explicit `ChatSnapshot` variable and internal store
   interface fixed strict TypeScript declaration emission without unsafe casts.
2. **Browser locator ambiguity.** Exact `getByLabel` lookup on wrapping select labels also
   included nested option text. Browser tests now locate the observed semantic combobox
   by its accessible name. Product labels remain semantic native labels.
3. **Popup Tab boundary.** Chromium's native modal can move sequential focus to browser
   chrome after the last control. The browser test caught this; explicit first/last Tab
   wrapping now keeps focus inside the dialog in both directions, while native dialog
   still supplies host inertness and Escape behavior.
4. **PowerShell comma argument splitting.** Unquoted Nx target lists yielded “No tasks
   were run.” Validation was rerun with quoted target arguments and actual results checked;
   the no-op commands were not counted as validation.

## Known limitations (non-blocking)

- React 19 only is the declared peer range; React 18, other browser engines, real mobile
  virtual keyboards, and manual NVDA/VoiceOver audits were not validated here. Chromium
  covers real keyboard/focus/mobile layout; jsdom covers component semantics.
- Native `<dialog>.showModal()` and modern CSS dynamic viewport/logical properties are
  required. No legacy-browser polyfill is bundled.
- History is ephemeral and unbounded. The active message is reparsed as Markdown on
  updates; no virtualization or chunk-throttling policy is claimed. Bundle measurements
  and render isolation are recorded, but there is no long-conversation load benchmark.
- Custom renderers are trusted host code and can violate accessibility/security if the
  application chooses unsafe behavior. Boundaries contain rendering failures, not effects
  or event-handler failures in arbitrary host code.
- Popup close retains the draft only while its input stays mounted; built-in panels
  unmount their contents on close, so unsent drafts reset. Accepted messages remain in the
  provider and active requests continue unless the application calls stop.
- System theme follows OS media preference, not an assumed host theme implementation.
  Hosts can force light/dark and override CSS variables explicitly.
- Packages are private and no npm publication was performed. Existing Phase 1–2 emitted
  test-file debt and process-local run registry limitations remain unchanged.
- Vite warns about `use client` directives in browser-only demo bundles; the unbundled
  library exports retain them. This does not affect the tested SPA/SSR behavior.

Attachments, persistent memory, application context, tools, generated components, approvals,
RAG and agents are deliberately outside this phase, not incomplete Phase 3 features.
