import { StrictMode, useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { CopilotProvider } from '@gixcopilot/react';
import { CopilotChat, CopilotPopup, CopilotSidebar } from '@gixcopilot/ui';
import '@gixcopilot/ui/styles.css';
import './preview.css';
import { readSettingsMessage, runtimeUrlFrom, toPreviewModel } from './settings.js';
import type { StudioSettings } from './settings.js';

const runtimeUrl = runtimeUrlFrom(window.location.search, window.location.origin);

/**
 * The live preview (§7): the real `@gixcopilot/ui` components, restyled from the settings the
 * Studio page posts. When a runtime URL is given, the chat talks to the real copilot server
 * (Test Copilot); the browser never calls a model provider.
 */
function Preview(): ReactElement {
  const [settings, setSettings] = useState<StudioSettings>({});
  useEffect(() => {
    const onMessage = (event: MessageEvent): void => {
      if (event.origin !== window.location.origin || event.source !== window.parent) return;
      const next = readSettingsMessage(event.data);
      if (next) setSettings(next);
    };
    window.addEventListener('message', onMessage);
    window.parent.postMessage({ type: 'gix-preview-ready' }, window.location.origin);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  const model = toPreviewModel(settings);
  const props = { title: model.title, suggestions: model.suggestions, labels: model.labels, theme: model.theme, style: model.style };
  const chat = model.layout === 'popup' ? <CopilotPopup {...props} placement={model.placement} defaultOpen /> : model.layout === 'sidebar' ? <CopilotSidebar {...props} placement={model.placement} defaultOpen /> : <CopilotChat {...props} />;
  return (
    <div className="preview" data-layout={model.layout}>
      {runtimeUrl ? <CopilotProvider runtimeUrl={runtimeUrl}>{chat}</CopilotProvider> : <CopilotProvider runtimeUrl={`${window.location.origin}/__gix/no-runtime`}>{chat}</CopilotProvider>}
      <footer className="preview-notes" aria-live="polite">
        {runtimeUrl ? <p>Connected to the copilot at {new URL(runtimeUrl).pathname || '/'}: messages run for real, through the Action Firewall.</p> : <p>No copilot runtime is connected, so messages will fail. Pass copilotRuntimeUrl to the Studio.</p>}
        {model.unsupported.length > 0 ? <p>Saved but not rendered (no slot in @gixcopilot/ui yet): {model.unsupported.join(', ')}.</p> : null}
      </footer>
    </div>
  );
}

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <Preview />
    </StrictMode>,
  );
}
