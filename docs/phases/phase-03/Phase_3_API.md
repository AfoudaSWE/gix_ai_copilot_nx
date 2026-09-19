# Phase 3 Public API

All imports use a package's root entry. Internal stores are not exported. Both libraries
are ESM and require a React peer matching `^19.0.0` (tested: 19.3.0).

## React provider

`@gixcopilot/react`:

```ts
function CopilotProvider(props: CopilotProviderProps): ReactElement;
type CopilotProviderProps = {
  children: ReactNode;
  model?: { provider: string; model: string };
  threadId?: string;
} & ({ runtimeUrl: string; client?: never } | { client: CopilotClient; runtimeUrl?: never });
```

All public properties are readonly in the source types. `runtimeUrl` is a base URL, not a
single POST endpoint. `client` injects the Phase 2 public client; use it for custom fetch
headers/auth/transport. `model` is passed opaquely to the server. Omit it for the server's
default runtime. `threadId` optionally seeds local request correlation, not persistent
memory. IDs/thread timestamps are generated only on the first accepted send.

```tsx
<CopilotProvider runtimeUrl='/api/copilot'><MyChat /></CopilotProvider>
<CopilotProvider client={stableClient} model={{ provider: 'mock', model: 'demo' }}>
  <MyChat />
</CopilotProvider>
```

No request starts during mount. Changing client identity, URL, model values or thread ID
cancels/reset the session. Ordinary rerenders with equivalent model values preserve it.
Unmount cancels its owned run without disposing an injected client's unrelated runs.
Invalid/missing connection configuration throws `CopilotError` (`VALIDATION_ERROR`).

## React hooks

All hooks take no parameters and must run beneath CopilotProvider; otherwise they throw
`CopilotError` (`VALIDATION_ERROR`). Subscriptions clean up on unmount. Empty initial SSR
snapshots match hydration. No hook collects application context.

| Name/signature                             | Return and behavior                                        | Example                                                                 |
| ------------------------------------------ | ---------------------------------------------------------- | ----------------------------------------------------------------------- |
| `useCopilot(): CopilotAccess`              | Stable `client` and all ChatActions; no token subscription | `const { stop } = useCopilot()`                                         |
| `useCopilotChat(): CopilotChatResult`      | Full ChatSnapshot plus ChatActions                         | `const { messages, sendMessage } = useCopilotChat()`                    |
| `useMessages(): readonly CopilotMessage[]` | Message-only snapshot; stable when messages do not change  | `const messages = useMessages()`                                        |
| `useCopilotStatus(): ChatStatus`           | Only state transitions, not each delta                     | `const busy = ['submitting', 'streaming'].includes(useCopilotStatus())` |
| `useThread(): Thread \| null`              | Local thread, null until first send and after clear        | `const thread = useThread()`                                            |

## Headless contracts and actions

```ts
type ChatStatus = 'idle' | 'submitting' | 'streaming' | 'completed' | 'stopped' | 'error';
interface CopilotMessage extends Message {
  readonly status: 'complete' | 'streaming' | 'stopped' | 'error';
}
// ChatSnapshot is a discriminated union: error is non-null iff status is 'error'.
// Common fields:
// messages: readonly CopilotMessage[]; thread: Thread | null; runId: string | null;
// usage: Usage | undefined; finishReason: FinishReason | undefined;
// error: PublicCopilotError | null; status: ChatStatus;
interface ChatActions {
  sendMessage(text: string): boolean;
  stop(): void;
  retry(): boolean;
  regenerate(): boolean;
  clear(): void;
}
type CopilotChatResult = ChatSnapshot & ChatActions;
interface CopilotAccess extends ChatActions {
  readonly client: CopilotClient;
}
```

The fields of Message (id/threadId/role/content/createdAt), Thread, Usage, FinishReason and
PublicCopilotError retain their protocol meanings. Presentation metadata is stripped when
building client input. Usage/finishReason are not fabricated by React and reset per run.

| Action        | Parameters / return           | Behavior, errors and lifecycle                                                                                                                                                 | Example                                            |
| ------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------- |
| `sendMessage` | User text; boolean acceptance | Reject blank, busy or disposed sends with false. Preserve original accepted text optimistically. One active run. Async failures surface in snapshot, not an unhandled promise. | `if (sendMessage(draft)) setDraft('')`             |
| `stop`        | None; void                    | Idempotently cancel actual client run, retain partial text, enter stopped. No-op when idle/terminal.                                                                           | `<button onClick={stop}>Stop</button>`             |
| `retry`       | None; boolean acceptance      | Only error state; replay failed turn's input, replace partial answer, preserve user ID. A fresh request, not stream resumption/backoff.                                        | `<button onClick={retry}>Retry</button>`           |
| `regenerate`  | None; boolean acceptance      | Only completed/stopped; replay latest user turn and replace its answer. Earlier history stays unchanged.                                                                       | `<button onClick={regenerate}>Regenerate</button>` |
| `clear`       | None; void                    | Cancel active generation, clear local messages/replay/metadata/thread; no server deletion. A configured threadId is reused on the next send.                                   | `<button onClick={clear}>Clear</button>`           |

Raw error messages are diagnostic protocol data. Custom UIs should map codes to safe copy,
as the default UI does, rather than displaying internal server/provider messages.

## UI containers

`@gixcopilot/ui`; import `@gixcopilot/ui/styles.css` once. All rendered components return
ReactElement. `UserMessage`/`AssistantMessage` are memoized `ComponentType<MessageProps>`.

```ts
function CopilotChat(props: CopilotChatProps): ReactElement;
function CopilotPopup(props: CopilotPanelProps): ReactElement;
function CopilotSidebar(props: CopilotPanelProps): ReactElement;
```

`CopilotChatProps`: optional `title` (default AI Copilot), `suggestions: readonly string[]`,
`labels: Partial<CopilotLabels>`, `components: CopilotComponents`, `theme: 'light' | 'dark' |
'system'` (system), `dir: 'ltr' | 'rtl' | 'auto'` (inherit), `className`, `style: CSSProperties`,
`headerActions: ReactNode`, and `onRenderError(error: Error, info: ErrorInfo): void`.

`CopilotPanelProps` adds `open?: boolean`, `defaultOpen?: boolean`,
`onOpenChange?: (open: boolean) => void`, `placement?: 'start' | 'end'` (end). Popup starts
closed; sidebar starts open. Controlled mode requires the host to update `open` in
response to the callback. The popup is modal; sidebar is a nonmodal aside in host layout.
Escape dismisses; focus moves into the input and returns on close. Popup wraps Tab/
Shift+Tab and uses native dialog inertness. Closing retains provider state/active request.
Native dialog support is required. Browser APIs run only in effects/events.

```tsx
<CopilotChat title='Help' theme='dark' suggestions={['Explain SSE']} />
<CopilotPopup open={open} onOpenChange={setOpen} placement='start' />
<CopilotSidebar dir='rtl' labels={{ send: 'إرسال' }} />
```

Containers and hooked primitives require the provider and share its validation error when
missing. Render errors are caught locally and sent to onRenderError, or logged to console
if no callback exists. Network errors stay in the headless state and safe error UI.

## Slots and composable components

`CopilotComponents` slots: Header (`ChatHeaderProps`), UserMessage and AssistantMessage
(`MessageProps`), Input (`ChatInputProps`), EmptyState (`EmptyStateProps`). Slots must
preserve accessibility and safe rendering. They are trusted application code, not model
generated code. Example: `<CopilotChat components={{ AssistantMessage: CustomAnswer }} />`.

| Export/signature                        | Props / behavior                                                                           | Example / errors and lifecycle                                                           |
| --------------------------------------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| `ChatHeader(props: ChatHeaderProps)`    | title, labels, optional children; heading/controls                                         | `<ChatHeader title='Help' labels={DEFAULT_LABELS} />`; presentational                    |
| `MessageList(props: MessageListProps)`  | optional labels, components, onRenderError; subscribes to messages, reader-aware scrolling | `<MessageList />`; provider required; message renderer errors contained                  |
| `UserMessage(props: MessageProps)`      | message and labels; escaped text                                                           | `<UserMessage message={message} labels={DEFAULT_LABELS} />`; presentational              |
| `AssistantMessage(props: MessageProps)` | message and labels; safe Markdown and partial marker                                       | `<AssistantMessage message={message} labels={DEFAULT_LABELS} />`; presentational         |
| `ChatInput(props: ChatInputProps)`      | optional labels; local draft, Enter/Shift+Enter/IME; Send/Stop                             | `<ChatInput />`; draft cleared only on acceptance; unmount resets draft                  |
| `SendButton({ disabled?, label? })`     | Native submit, default Send                                                                | Place inside a form; presentational                                                      |
| `StopButton({ label? })`                | Native button invokes stop                                                                 | `<StopButton />`; provider required                                                      |
| `RetryButton({ label? })`               | Native button invokes retry                                                                | `<RetryButton />`; provider required, action rejects invalid state                       |
| `RegenerateButton({ label? })`          | Native button invokes regenerate                                                           | `<RegenerateButton />`; provider required, action rejects invalid state                  |
| `Suggestions(props: SuggestionsProps)`  | suggestions and optional labels; static send buttons, disabled while busy                  | `<Suggestions suggestions={['Hello']} />`; provider required                             |
| `EmptyState(props: EmptyStateProps)`    | suggestions and required labels; invitation + suggestions                                  | `<EmptyState suggestions={[]} labels={DEFAULT_LABELS} />`; provider required             |
| `TypingIndicator({ label? })`           | Quiet pre-token feedback, default submitting label                                         | `<TypingIndicator />`; presentational, no timer                                          |
| `ErrorMessage({ error, labels? })`      | Non-null chat error; safe code-based message and Retry                                     | `<ErrorMessage error={error} />`; provider required for Retry                            |
| `Markdown(props: MarkdownProps)`        | content string and optional labels; GFM, safe URLs, no HTML/images                         | `<Markdown content={text} />`; presentational, malformed Markdown treated as content     |
| `CodeBlock(props: CodeBlockProps)`      | code string, optional language and labels; literal code and copy                           | `<CodeBlock code='const n = 1' language='ts' />`; clipboard failure gives local feedback |

The public types exported alongside these are `CopilotChatProps`, `CopilotPanelProps`,
`CopilotComponents`, `ChatHeaderProps`, `MessageProps`, `MessageListProps`, `ChatInputProps`,
`SuggestionsProps`, `EmptyStateProps`, `MarkdownProps`, `CodeBlockProps`, `CopilotLabels`.

## Labels and theme tokens

`DEFAULT_LABELS: CopilotLabels` is the centralized English dictionary. Its keys are:
send, stop, retry, regenerate, clear, copy, copied, copyFailed, code, input, placeholder,
inputHint, open, close, conversation, user, assistant, system, emptyTitle, emptyDescription,
suggestions, submitting, streaming, completed, stopped, failed, connectionError,
timeoutError, rateLimitError, jumpToLatest, renderError. Containers merge partial overrides;
standalone primitives accept a complete dictionary or use defaults. `title` is separate.

Theme tokens: `--copilot-background`, `--copilot-foreground`, `--copilot-surface`,
`--copilot-muted`, `--copilot-border`, `--copilot-primary`, `--copilot-on-primary`,
`--copilot-danger`, `--copilot-radius`, `--copilot-font-family`. Override through application
CSS (example: `.brand.gix-copilot { --copilot-radius: 12px; }`). CSS is explicitly
side-effectful; JavaScript imports are tree-shakeable and SSR safe.
