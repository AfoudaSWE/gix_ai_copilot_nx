import { z } from 'zod';
import { useGenerativeComponent } from '@gixcopilot/react';

function ApplicationCard({ applicationId, status }: { applicationId: string; status: string }) {
  return (
    <article>
      <h3>{applicationId}</h3>
      <p>{status}</p>
    </article>
  );
}

export function TrustedComponents() {
  // The model can only select this component and supply props that pass the schema.
  useGenerativeComponent({
    name: 'ApplicationCard',
    description: 'Shows one visa application',
    props: z.object({ applicationId: z.string(), status: z.string() }),
    component: ApplicationCard,
  });
  return null;
}
