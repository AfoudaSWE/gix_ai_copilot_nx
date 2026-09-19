import { Component, memo, useEffect, useId, useRef, useState } from 'react';
import type { ComponentType, CSSProperties, ErrorInfo, ReactElement, ReactNode } from 'react';
import {
  useCopilot,
  useCopilotChat,
  useCopilotStatus,
  useMessages,
  useResolveToolRenderer,
  useToolCalls,
} from '@gixcopilot/react';
import type { CopilotChatResult, CopilotMessage, ToolCallState } from '@gixcopilot/react';
import { DEFAULT_LABELS } from './labels.js';
import type { CopilotLabels } from './labels.js';
import { Markdown } from './markdown.js';

/**
 * Text content only. A message may also carry `tool_call`/`tool_result` parts (Phase 5) -
 * this default rendering intentionally shows only the text portion; tool activity is
 * rendered separately (see `ToolActivity`) so raw tool arguments/results are never
 * accidentally dumped into the chat transcript.
 */
function textOfContent(content: CopilotMessage['content']): string {
  return content
    .filter((part): part is Extract<typeof part, { type: 'text' }> => part.type === 'text')
    .map((part) => part.text)
    .join('');
}

/** Props shared by user, assistant, and custom message renderers. */
export interface MessageProps {
  readonly message: CopilotMessage;
  readonly labels: CopilotLabels;
}
/** Props for a replaceable chat header. */
export interface ChatHeaderProps {
  readonly title: string;
  readonly labels: CopilotLabels;
  readonly children?: ReactNode;
}
/** Props for the input slot; controls remain connected to the headless provider. */
export interface ChatInputProps {
  readonly labels?: CopilotLabels;
}
/** Static suggestions only; no application context is collected. */
export interface SuggestionsProps {
  readonly suggestions: readonly string[];
  readonly labels?: CopilotLabels;
}
/** Props for a replaceable initial invitation. */
export interface EmptyStateProps extends SuggestionsProps {
  readonly labels: CopilotLabels;
}
/** Props for the tool activity slot (Section 59-61, added in Phase 5). */
export interface ToolActivityProps {
  readonly toolCalls: readonly ToolCallState[];
  readonly labels: CopilotLabels;
  /**
   * Resolves one tool call to custom content - a rendered generative-UI component or a
   * `useToolRenderer` override (Section 27-31, 59, added in Phase 6) - or `undefined` to
   * fall back to the generic row below. Optional so a custom `ToolActivity` slot
   * (`components.ToolActivity`) keeps working unmodified if it does not accept this prop.
   */
  readonly resolveRenderer?: (toolCall: ToolCallState) => ReactNode | undefined;
  readonly onRenderError?: CopilotChatProps['onRenderError'];
}
/** Consistent component slots for the major UI areas. */
export interface CopilotComponents {
  readonly Header?: ComponentType<ChatHeaderProps>;
  readonly UserMessage?: ComponentType<MessageProps>;
  readonly AssistantMessage?: ComponentType<MessageProps>;
  readonly Input?: ComponentType<ChatInputProps>;
  readonly EmptyState?: ComponentType<EmptyStateProps>;
  readonly ToolActivity?: ComponentType<ToolActivityProps>;
}
/** Theme tokens live in the CSS export and can be overridden with className/style. */
export interface CopilotChatProps {
  readonly title?: string;
  readonly suggestions?: readonly string[];
  readonly labels?: Partial<CopilotLabels>;
  readonly components?: CopilotComponents;
  readonly theme?: 'light' | 'dark' | 'system';
  readonly dir?: 'ltr' | 'rtl' | 'auto';
  readonly className?: string;
  readonly style?: CSSProperties;
  readonly headerActions?: ReactNode;
  readonly onRenderError?: (error: Error, info: ErrorInfo) => void;
}

/** Heading and consumer-supplied header controls. */
export function ChatHeader({ title, children }: ChatHeaderProps): ReactElement {
  return (
    <header className="gix-header">
      <div className="gix-identity">
        <span className="gix-mark" aria-hidden="true">
          ✳
        </span>
        <h2>{title}</h2>
      </div>
      {children}
    </header>
  );
}
/** Plain text user content is never interpreted as HTML. */
export const UserMessage: ComponentType<MessageProps> = memo(function UserMessage({
  message,
  labels,
}: MessageProps): ReactElement {
  return (
    <article className="gix-message gix-user">
      <span className="gix-message-label">{labels.user}</span>
      <div className="gix-user-text" dir="auto">
        {textOfContent(message.content)}
      </div>
    </article>
  );
});
/** Safe Markdown for assistant output, with a visible partial-response marker. */
export const AssistantMessage: ComponentType<MessageProps> = memo(function AssistantMessage({
  message,
  labels,
}: MessageProps): ReactElement {
  return (
    <article className="gix-message gix-assistant">
      <span className="gix-message-label">
        {message.role === 'assistant' ? labels.assistant : labels.system}
      </span>
      <Markdown content={textOfContent(message.content)} labels={labels} />
      {message.status === 'streaming' ? (
        <span className="gix-stream-cursor" aria-hidden="true" />
      ) : null}
      {message.status === 'stopped' ? <small>{labels.stopped}</small> : null}
    </article>
  );
});

interface BoundaryProps {
  readonly children: ReactNode;
  readonly fallback: string;
  readonly onError?: CopilotChatProps['onRenderError'];
}
class RenderBoundary extends Component<BoundaryProps, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }
  override componentDidCatch(error: Error, info: ErrorInfo): void {
    if (this.props.onError) this.props.onError(error, info);
    else console.error('Copilot renderer failed.', error);
  }
  override render(): ReactNode {
    return this.state.failed ? <p role="alert">{this.props.fallback}</p> : this.props.children;
  }
}

/** Message list scrolls only while the reader is following the latest content. */
export interface MessageListProps {
  readonly labels?: CopilotLabels;
  readonly components?: CopilotComponents;
  readonly onRenderError?: CopilotChatProps['onRenderError'];
}
export function MessageList({
  labels = DEFAULT_LABELS,
  components = {},
  onRenderError,
}: MessageListProps): ReactElement {
  const messages = useMessages();
  const viewport = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const [showJump, setShowJump] = useState(false);
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    if (following.current) element.scrollTop = element.scrollHeight;
    else setShowJump(true);
  }, [messages]);
  const User = components.UserMessage ?? UserMessage;
  const Assistant = components.AssistantMessage ?? AssistantMessage;
  return (
    <div className="gix-history">
      <div
        className="gix-message-list"
        ref={viewport}
        role="log"
        aria-label={labels.conversation}
        aria-live="off"
        tabIndex={0}
        onScroll={(event) => {
          const element = event.currentTarget;
          following.current = element.scrollHeight - element.scrollTop - element.clientHeight < 48;
          setShowJump(!following.current);
        }}
      >
        {messages.map((message) => (
          <RenderBoundary key={message.id} fallback={labels.renderError} onError={onRenderError}>
            {message.role === 'user' ? (
              <User message={message} labels={labels} />
            ) : (
              <Assistant message={message} labels={labels} />
            )}
          </RenderBoundary>
        ))}
      </div>
      {showJump ? (
        <button
          className="gix-jump"
          type="button"
          onClick={() => {
            following.current = true;
            if (viewport.current) viewport.current.scrollTop = viewport.current.scrollHeight;
            setShowJump(false);
          }}
        >
          {labels.jumpToLatest}
        </button>
      ) : null}
    </div>
  );
}

/** Buttons are native controls with localized visible labels. */
export function SendButton({
  disabled,
  label = DEFAULT_LABELS.send,
}: {
  readonly disabled?: boolean;
  readonly label?: string;
}): ReactElement {
  return (
    <button type="submit" className="gix-primary" disabled={disabled}>
      {label}
      <span aria-hidden="true"> ↵</span>
    </button>
  );
}
/** Cancels the active backend generation through the headless SDK. */
export function StopButton({
  label = DEFAULT_LABELS.stop,
}: {
  readonly label?: string;
}): ReactElement {
  const { stop } = useCopilot();
  return (
    <button type="button" className="gix-primary" onClick={stop}>
      <span aria-hidden="true">■ </span>
      {label}
    </button>
  );
}
/** Retries a failed turn, replacing its partial answer. */
export function RetryButton({
  label = DEFAULT_LABELS.retry,
}: {
  readonly label?: string;
}): ReactElement {
  const { retry } = useCopilot();
  return (
    <button type="button" onClick={retry}>
      {label}
    </button>
  );
}
/** Generates another answer to the latest completed/stopped turn. */
export function RegenerateButton({
  label = DEFAULT_LABELS.regenerate,
}: {
  readonly label?: string;
}): ReactElement {
  const { regenerate } = useCopilot();
  return (
    <button type="button" onClick={regenerate}>
      {label}
    </button>
  );
}

/** Enter sends; Shift+Enter inserts a newline; IME composition never submits. */
export function ChatInput({ labels = DEFAULT_LABELS }: ChatInputProps): ReactElement {
  const { sendMessage } = useCopilot();
  const status = useCopilotStatus();
  const busy = status === 'submitting' || status === 'streaming';
  const [value, setValue] = useState('');
  const composing = useRef(false);
  const id = useId();
  function send(): void {
    if (!busy && sendMessage(value)) setValue('');
  }
  return (
    <form
      className="gix-composer"
      onSubmit={(event) => {
        event.preventDefault();
        if (!composing.current) send();
      }}
    >
      <label className="gix-sr-only" htmlFor={id}>
        {labels.input}
      </label>
      <textarea
        id={id}
        value={value}
        rows={2}
        placeholder={labels.placeholder}
        dir="auto"
        aria-describedby={`${id}-hint`}
        onChange={(event) => setValue(event.target.value)}
        onCompositionStart={() => {
          composing.current = true;
        }}
        onCompositionEnd={() => {
          composing.current = false;
        }}
        onKeyDown={(event) => {
          if (
            event.key === 'Enter' &&
            !event.shiftKey &&
            !event.nativeEvent.isComposing &&
            !composing.current &&
            event.keyCode !== 229
          ) {
            event.preventDefault();
            send();
          }
        }}
      />
      <div className="gix-composer-footer">
        <small id={`${id}-hint`}>{labels.inputHint}</small>
        {busy ? (
          <StopButton label={labels.stop} />
        ) : (
          <SendButton label={labels.send} disabled={!value.trim()} />
        )}
      </div>
    </form>
  );
}

/** Clickable static prompts share the same send path as the input. */
export function Suggestions({
  suggestions,
  labels = DEFAULT_LABELS,
}: SuggestionsProps): ReactElement {
  const { sendMessage } = useCopilot();
  const status = useCopilotStatus();
  return (
    <div className="gix-suggestions" role="group" aria-label={labels.suggestions}>
      {suggestions.map((suggestion, index) => (
        <button
          type="button"
          key={`${index}-${suggestion}`}
          disabled={status === 'streaming' || status === 'submitting'}
          onClick={() => sendMessage(suggestion)}
        >
          {suggestion}
          <span aria-hidden="true">↗</span>
        </button>
      ))}
    </div>
  );
}
/** Initial invitation plus optional suggested prompts. */
export function EmptyState({ suggestions, labels }: EmptyStateProps): ReactElement {
  return (
    <div className="gix-empty">
      <span className="gix-empty-mark" aria-hidden="true">
        ✳
      </span>
      <h3>{labels.emptyTitle}</h3>
      <p>{labels.emptyDescription}</p>
      <Suggestions suggestions={suggestions} labels={labels} />
    </div>
  );
}
/** Quiet pre-token indicator. Streaming itself communicates activity thereafter. */
export function TypingIndicator({
  label = DEFAULT_LABELS.submitting,
}: {
  readonly label?: string;
}): ReactElement {
  return (
    <p className="gix-typing">
      <span aria-hidden="true">● ● ● </span>
      {label}
    </p>
  );
}

/**
 * Generic tool activity rendering (Section 59-61), built on `useToolCalls()`'s headless
 * state. Deliberately does not render raw `arguments`/`result` by default (Section 60,
 * 62) - only the tool's `name` and lifecycle status, since a tool's inputs/outputs may
 * contain data the host application does not want blindly dumped into the transcript. A
 * host that wants richer per-tool rendering overrides this slot entirely via
 * `components.ToolActivity`, or resolves individual tool calls via `useGenerativeComponent`/
 * `useToolRenderer` (Section 27-31, 59-61, added in Phase 6) and lets this default renderer
 * pick it up through `resolveRenderer`. Each resolved item is wrapped in its own
 * `RenderBoundary` (Section 56) - one generative component or custom renderer throwing
 * degrades to a safe fallback row, not a crashed chat.
 */
/**
 * A distinct child component, deliberately: `resolveRenderer(toolCall)` may invoke a
 * host-supplied callback (a generative component's own render, or a `useToolRenderer`
 * function) that can throw *synchronously while called*, not just while its returned JSX is
 * later rendered. React only catches an error boundary's *descendant's* render failures -
 * calling `resolveRenderer` directly inside `ToolActivity`'s own body would throw past any
 * boundary placed underneath it, up to whatever wraps `<ToolActivity>` itself (taking down
 * the whole chat, not just one row). Giving each row its own component means that call
 * happens during *this* component's render, which the `RenderBoundary` wrapped around it
 * from `ToolActivity` (its parent, not itself) correctly isolates (Section 56).
 */
function ToolActivityRow({
  toolCall,
  labels,
  resolveRenderer,
}: {
  readonly toolCall: ToolCallState;
  readonly labels: CopilotLabels;
  readonly resolveRenderer: ToolActivityProps['resolveRenderer'];
}): ReactElement {
  const custom = resolveRenderer?.(toolCall);
  if (custom !== undefined) return <>{custom}</>;
  if (toolCall.status === 'requested' || toolCall.status === 'running') {
    return (
      <>
        <span aria-hidden="true">● </span>
        {labels.toolRunning} {toolCall.name}…
      </>
    );
  }
  if (toolCall.status === 'succeeded') {
    return (
      <>
        <span aria-hidden="true">✓ </span>
        {toolCall.name} {labels.toolCompleted}
      </>
    );
  }
  return (
    <>
      <span aria-hidden="true">✗ </span>
      {toolCall.name} {labels.toolFailed}
    </>
  );
}

export function ToolActivity({
  toolCalls,
  labels,
  resolveRenderer,
  onRenderError,
}: ToolActivityProps): ReactElement | null {
  if (toolCalls.length === 0) return null;
  return (
    <ul className="gix-tool-activity" aria-label={labels.conversation}>
      {toolCalls.map((toolCall) => (
        <li key={toolCall.id} className={`gix-tool-activity-item gix-tool-${toolCall.status}`}>
          <RenderBoundary fallback={labels.renderError} onError={onRenderError}>
            <ToolActivityRow toolCall={toolCall} labels={labels} resolveRenderer={resolveRenderer} />
          </RenderBoundary>
        </li>
      ))}
    </ul>
  );
}

/** Safe user-facing error copy; raw provider error messages are never rendered. */
export function ErrorMessage({
  error,
  labels = DEFAULT_LABELS,
}: {
  readonly error: NonNullable<CopilotChatResult['error']>;
  readonly labels?: CopilotLabels;
}): ReactElement {
  const text =
    error.code === 'TIMEOUT'
      ? labels.timeoutError
      : error.code === 'RATE_LIMITED'
        ? labels.rateLimitError
        : error.code === 'NETWORK_ERROR' || error.code === 'TRANSPORT_ERROR'
          ? labels.connectionError
          : labels.failed;
  return (
    <div className="gix-error" role="alert">
      <span>{text}</span>
      <RetryButton label={labels.retry} />
    </div>
  );
}

function ChatContent({
  labels,
  suggestions,
  components,
  onRenderError,
}: {
  labels: CopilotLabels;
  suggestions: readonly string[];
  components: CopilotComponents;
  onRenderError?: CopilotChatProps['onRenderError'];
}): ReactElement {
  const { status, error, messages } = useCopilotChat();
  const toolCalls = useToolCalls();
  const resolveRenderer = useResolveToolRenderer();
  const Empty = components.EmptyState ?? EmptyState;
  const Activity = components.ToolActivity ?? ToolActivity;
  const announcement =
    status === 'submitting'
      ? labels.submitting
      : status === 'streaming'
        ? labels.streaming
        : status === 'completed'
          ? `${labels.completed}. ${
              messages.at(-1) ? textOfContent(messages.at(-1)?.content ?? []) : ''
            }`
          : status === 'stopped'
            ? labels.stopped
            : '';
  return (
    <>
      {messages.length === 0 ? (
        <Empty suggestions={suggestions} labels={labels} />
      ) : (
        <MessageList labels={labels} components={components} onRenderError={onRenderError} />
      )}
      <div className="gix-sr-only" role="status" aria-live="polite" aria-atomic="true">
        {announcement}
      </div>
      <Activity
        toolCalls={toolCalls}
        labels={labels}
        resolveRenderer={resolveRenderer}
        onRenderError={onRenderError}
      />
      {status === 'submitting' && toolCalls.length === 0 ? (
        <TypingIndicator label={labels.submitting} />
      ) : null}
      {error ? <ErrorMessage error={error} labels={labels} /> : null}
      {status === 'completed' || status === 'stopped' ? (
        <div className="gix-response-actions">
          <span>{status === 'stopped' ? labels.stopped : labels.completed}</span>
          <RegenerateButton label={labels.regenerate} />
        </div>
      ) : null}
    </>
  );
}

/** Embedded full chat with replaceable renderers, localized labels and theme tokens. */
export function CopilotChat({
  title = 'AI Copilot',
  suggestions = [],
  labels: overrides,
  components = {},
  theme = 'system',
  dir,
  className = '',
  style,
  headerActions,
  onRenderError,
}: CopilotChatProps): ReactElement {
  const labels = { ...DEFAULT_LABELS, ...overrides };
  const Header = components.Header ?? ChatHeader;
  const Input = components.Input ?? ChatInput;
  return (
    <section
      className={`gix-copilot ${className}`}
      data-theme={theme}
      dir={dir}
      style={style}
      aria-label={title}
    >
      <RenderBoundary fallback={labels.renderError} onError={onRenderError}>
        <Header title={title} labels={labels}>
          {headerActions}
        </Header>
        <ChatContent
          labels={labels}
          suggestions={suggestions}
          components={components}
          onRenderError={onRenderError}
        />
        <Input labels={labels} />
      </RenderBoundary>
    </section>
  );
}
