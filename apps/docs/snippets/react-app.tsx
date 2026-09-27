import { createRoot } from 'react-dom/client';
import { CopilotProvider } from '@gixcopilot/react';
import { CopilotChat } from '@gixcopilot/ui';
import '@gixcopilot/ui/styles.css';

createRoot(document.getElementById('root') as HTMLElement).render(
  <CopilotProvider runtimeUrl="/api/copilot">
    <CopilotChat />
  </CopilotProvider>,
);
