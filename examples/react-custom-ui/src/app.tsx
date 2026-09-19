import { useState } from 'react';
import type { ReactElement } from 'react';
import { CopilotProvider, useCopilotChat } from '@gixcopilot/react';
import type { CopilotMessage } from '@gixcopilot/react';

/** Text content only - a message may also carry Phase 5 tool_call/tool_result parts. */
function textOfContent(content: CopilotMessage['content']): string {
  return content
    .filter((part): part is Extract<typeof part, { type: 'text' }> => part.type === 'text')
    .map((part) => part.text)
    .join('');
}

/** Entirely custom interface: no import or dependency on @gixcopilot/ui. */
export function CustomChat(): ReactElement {
  const { messages, status, error, sendMessage, stop, retry, regenerate, clear } = useCopilotChat();
  const [text, setText] = useState('');
  const busy = status === 'submitting' || status === 'streaming';
  return (
    <main>
      <header>
        <p>GIX COPILOT / HEADLESS EXAMPLE</p>
        <h1>A conversation on your terms.</h1>
        <p>
          This interface uses only the React hooks. Every element and style belongs to the
          application.
        </p>
      </header>
      <section aria-label="Conversation">
        <ol aria-live="off">
          {messages.map((message) => (
            <li key={message.id}>
              <strong>{message.role === 'user' ? 'You' : 'Copilot'}</strong>
              <p>{textOfContent(message.content)}</p>
            </li>
          ))}
        </ol>
      </section>
      <p role="status">{status}</p>
      {error ? (
        <div role="alert">
          The response could not be completed. <button onClick={retry}>Retry</button>
        </div>
      ) : null}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (sendMessage(text)) setText('');
        }}
      >
        <label htmlFor="message">Your message</label>
        <textarea id="message" value={text} onChange={(event) => setText(event.target.value)} />
        <div className="actions">
          {busy ? (
            <button type="button" onClick={stop}>
              Stop
            </button>
          ) : (
            <button disabled={!text.trim()} type="submit">
              Send
            </button>
          )}
          <button type="button" onClick={clear}>
            Clear
          </button>
          {status === 'completed' || status === 'stopped' ? (
            <button type="button" onClick={regenerate}>
              Regenerate
            </button>
          ) : null}
        </div>
      </form>
    </main>
  );
}

/** Same-origin base URL is forwarded unchanged to the existing client. */
export function App(): ReactElement {
  return (
    <CopilotProvider runtimeUrl="/api/copilot">
      <CustomChat />
    </CopilotProvider>
  );
}
