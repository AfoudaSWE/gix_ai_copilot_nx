import { useCopilotContext } from '@gixcopilot/react';

export function ApplicationPage({ application }: { application: { id: string; status: string } }) {
  // Only registered context reaches the model; it is removed when the page unmounts.
  useCopilotContext({ name: 'Selected application', value: application, scope: 'page', sensitivity: 'internal' });
  return <h1>{application.id}</h1>;
}
