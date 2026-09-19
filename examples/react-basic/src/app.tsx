import { useState } from 'react';
import type { ReactElement } from 'react';
import { CopilotProvider, useCopilot } from '@gixcopilot/react';
import { CopilotChat, CopilotPopup, CopilotSidebar } from '@gixcopilot/ui';
import type { CopilotChatProps } from '@gixcopilot/ui';

const suggestions = [
  'Explain streaming responses',
  'How does Stop work?',
  'Show me a code example',
];
function Clear(): ReactElement {
  const { clear } = useCopilot();
  return (
    <button type="button" onClick={clear}>
      Clear chat
    </button>
  );
}

/** The workbench demonstrates the same chat state through three interchangeable views. */
export function App(): ReactElement {
  const [view, setView] = useState('popup');
  const [theme, setTheme] = useState<NonNullable<CopilotChatProps['theme']>>('light');
  const [rtl, setRtl] = useState(false);
  const [provider, setProvider] = useState('mock');
  const chatProps = {
    title: 'Gix Copilot',
    suggestions,
    theme,
    dir: rtl ? ('rtl' as const) : ('ltr' as const),
    headerActions: <Clear />,
  };
  return (
    <CopilotProvider
      runtimeUrl="/api/copilot"
      model={{ provider, model: provider === 'openai' ? 'gpt-4o-mini' : 'demo' }}
    >
      <div className="lab">
        <header className="lab-header">
          <a className="lab-brand" href="/">
            gix<span>copilot</span>
          </a>
          <span className="lab-tag">INTERFACE LAB</span>
          <a href="http://127.0.0.1:5174">Headless example ↗</a>
        </header>
        <main className="lab-main">
          <div className="lab-intro">
            <p className="lab-eyebrow">REACT COPILOT UI / PHASE 03</p>
            <h1>
              Your interface.
              <br />
              <span>A conversation away.</span>
            </h1>
            <p>
              Put a copilot where your work happens. Try an embedded chat, a side panel, or a popup
              that stays within reach.
            </p>
          </div>
          <div className="lab-controls" aria-label="Example settings">
            <div className="lab-views" role="group" aria-label="Chat layout">
              {['popup', 'chat', 'sidebar'].map((option) => (
                <button
                  key={option}
                  type="button"
                  aria-pressed={view === option}
                  onClick={() => setView(option)}
                >
                  {option === 'chat' ? 'Embedded chat' : option === 'popup' ? 'Popup' : 'Sidebar'}
                </button>
              ))}
            </div>
            <label>
              Theme
              <select
                value={theme}
                onChange={(event) => {
                  const value = event.target.value;
                  if (value === 'light' || value === 'dark' || value === 'system') setTheme(value);
                }}
              >
                <option value="light">Light</option>
                <option value="dark">Dark</option>
                <option value="system">System</option>
              </select>
            </label>
            <label>
              Response
              <select value={provider} onChange={(event) => setProvider(event.target.value)}>
                <option value="mock">Streaming</option>
                <option value="slow">Slow response</option>
                <option value="failure">Fail once, then retry</option>
                <option value="openai">OpenAI (live)</option>
              </select>
            </label>
            <label className="lab-rtl">
              <input
                type="checkbox"
                checked={rtl}
                onChange={(event) => setRtl(event.target.checked)}
              />
              Right to left
            </label>
          </div>
          <div className={`lab-stage lab-stage-${view}`}>
            {view === 'chat' ? (
              <CopilotChat {...chatProps} />
            ) : (
              <section className="lab-note">
                <span className="lab-note-symbol" aria-hidden="true">
                  ↳
                </span>
                <h2>Room for your application.</h2>
                <p>Your product keeps its own layout. The copilot brings the conversation.</p>
                <div className="lab-code">
                  <span>Two components to get started</span>
                  <pre>
                    <code>
                      {
                        '<CopilotProvider runtimeUrl="/api/copilot">\n  <App />\n  <CopilotPopup />\n</CopilotProvider>'
                      }
                    </code>
                  </pre>
                </div>
                <p className="lab-note-foot">
                  This demo streams a deterministic response by default. No API key required,
                  unless the server has OPENAI_API_KEY set and "OpenAI (live)" is selected.
                </p>
              </section>
            )}
            {view === 'sidebar' ? <CopilotSidebar {...chatProps} /> : null}
          </div>
          <footer className="lab-footer">
            <span>HEADLESS BY DEFAULT · CUSTOMIZABLE BY DESIGN</span>
            <span>React → Client → Protocol</span>
          </footer>
        </main>
        {view === 'popup' ? <CopilotPopup {...chatProps} /> : null}
      </div>
    </CopilotProvider>
  );
}
