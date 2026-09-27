# @gixcopilot/ui

Composable React chat, modal popup, and in-flow sidebar built only on
`@gixcopilot/react`. React peer range: `^19.0.0`, tested with 19.3.0.

## Install

```bash
npm install @gixcopilot/ui react
```

Requires Node.js >=22.12.0. ESM only.

```tsx
import { CopilotProvider } from '@gixcopilot/react';
import { CopilotPopup } from '@gixcopilot/ui';
import '@gixcopilot/ui/styles.css';

export function App() {
  return (
    <CopilotProvider runtimeUrl="/api/copilot">
      <CopilotPopup title="AI Copilot" suggestions={['Explain SSE']} theme="system" />
    </CopilotProvider>
  );
}
```

Replace `CopilotPopup` with `CopilotChat` for embedding or `CopilotSidebar` for an in-flow
application panel. The sidebar belongs in your flex/grid layout; it never makes host
content inert. The popup uses a native modal `<dialog>` and makes host content inert while
open. Both manage focus and Escape, and support `open`/`onOpenChange` or `defaultOpen`.
Closing a panel retains provider history and lets its active run continue; call `stop()`
when closing if your application prefers to cancel it.

Customization:

```tsx
<CopilotChat
  theme="dark"
  dir="rtl"
  className="brand-chat"
  labels={{ send: 'إرسال', input: 'رسالة' }}
  components={{ AssistantMessage: MyAssistantMessage }}
  onRenderError={(error) => reportRendererError(error)}
/>
```

`MyAssistantMessage` receives `{ message, labels }` (`MessageProps`). The slots are Header,
UserMessage, AssistantMessage, Input, and EmptyState. Composable base components are also
exported. All visible default strings are centralized in `DEFAULT_LABELS` (except the
configurable title). Errors use safe code-based text, never raw provider messages.

Import the CSS once. Override semantic custom properties in an application stylesheet:

```css
.brand-chat.gix-copilot {
  --copilot-primary: #356337;
  --copilot-on-primary: #ffffff;
  --copilot-radius: 12px;
  --copilot-font-family: system-ui, sans-serif;
}
```

Other tokens: `--copilot-background`, `--copilot-foreground`, `--copilot-surface`,
`--copilot-muted`, `--copilot-border`, `--copilot-danger`. Theme modes are light/dark/system;
no host theme framework or Tailwind setup is required. Logical CSS supports RTL. Popup
placement is `start`/`end` relative to text direction. Small screens use dynamic viewport
height. Preserve contrast when overriding tokens.

Markdown supports headings, paragraphs, lists, links, tables, quotes, inline code and
copyable code blocks. Raw HTML and remote images are disabled, unsafe URL schemes are
rejected, and links use `noopener noreferrer`. Nothing generated is executed. Custom
renderers are trusted application code and must preserve this security boundary.

Native keyboard controls, IME-safe input, focus containment/restoration, reduced motion,
completion announcements, and reader-aware scrolling are included. The transcript is not
announced token by token. See [Phase 3 API](../../docs/phases/phase-03/Phase_3_API.md) and
[browser testing evidence](../../docs/phases/phase-03/Phase_3_Testing.md). Modern browsers
with `<dialog>.showModal()` are required; no legacy browser polyfill is bundled.

## Tool activity and generative UI (Phase 5–6)

`CopilotChat` automatically renders a generic tool-activity row for every in-flight or
completed tool call from `@gixcopilot/react`'s `useToolCalls()` — showing only the tool's
name and lifecycle status by default, never raw arguments/results. Override the whole slot
via `components.ToolActivity`, or let a registered `useGenerativeComponent` /
`useToolRenderer` (both `@gixcopilot/react`, Phase 6) resolve automatically: each activity
row is wrapped in its own render-error boundary, so one throwing renderer degrades to a safe
fallback for that row only, never the whole chat.

```tsx
<CopilotChat components={{ ToolActivity: MyToolActivity }} />
```

`MyToolActivity` receives `{ toolCalls, labels, resolveRenderer?, onRenderError? }`
(`ToolActivityProps`) if it wants to keep automatic generative-UI/custom-renderer
resolution; a fully custom slot can ignore `resolveRenderer` and render `toolCalls` itself.
See [Phase 5 API](../../docs/phases/phase-05/Phase_5_API.md) and
[Phase 6 API](../../docs/phases/phase-06/Phase_6_API.md).

## Documentation

- [react guide](https://github.com/AfoudaSWE/gix_ai_copilot_nx/blob/main/docs/guides/react.md)
- [Getting started](https://github.com/AfoudaSWE/gix_ai_copilot_nx/blob/main/docs/guides/getting-started.md)
- [Source](https://github.com/AfoudaSWE/gix_ai_copilot_nx/tree/main/packages/ui)

## License

MIT
