import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { CopilotProvider } from '@gixcopilot/react';
import { CopilotPopup } from '@gixcopilot/ui';
import { App } from './app.js';
import '@gixcopilot/ui/styles.css';
import './styles.css';

const suggestions = [
  'Who are the admins?',
  'Add Sam Lee, sam@example.com, as a Viewer',
  'Make Sam Lee a Member',
];

// Local development fixture matching LOCAL_DEV_TOKEN in api/copilot.ts - not a real credential.
// A real app sends its own session token so the copilot acts as the signed-in user.
const copilotHeaders = (): Record<string, string> => ({
  authorization: 'Bearer users-crud-local-dev',
});

const root = document.getElementById('root');
if (!root) throw new Error('Missing application root');
createRoot(root).render(
  <StrictMode>
    <CopilotProvider runtimeUrl="/api/copilot" getHeaders={copilotHeaders}>
      <App />
      <CopilotPopup title="Directory assistant" suggestions={suggestions} />
    </CopilotProvider>
  </StrictMode>,
);
