import { z } from 'zod';
import { defineTool } from '@gixcopilot/tools';

/** Real, deterministic state each tool step reads/writes (Section 169) - a genuine tool
 * call round trip, not a fixture. */
const applications = new Map<string, { status: string; paid: boolean }>([
  ['APP-1024', { status: 'submitted', paid: true }],
]);

export const verifyPaymentTool = defineTool({
  name: 'payments.verify',
  description: "Verify an application's payment method.",
  input: z.object({ applicationId: z.string() }),
  execute: (input) => {
    const application = applications.get(input.applicationId);
    return Promise.resolve({ verified: application?.paid ?? false });
  },
});

export const updateApplicationTool = defineTool({
  name: 'applications.update',
  description: 'Marks an application approved.',
  input: z.object({ applicationId: z.string() }),
  // Consequential (Section 122) - this is exactly why the workflow gates it behind a real
  // supervisor approval step first, not a tool-level approval tier of its own.
  security: { requiredPermissions: ['applications.update'], approval: 'none' },
  execute: (input) => {
    const application = applications.get(input.applicationId);
    if (!application) throw new Error(`Unknown application "${input.applicationId}".`);
    application.status = 'approved';
    return Promise.resolve({ status: application.status });
  },
});

export function getApplication(id: string): { status: string; paid: boolean } | undefined {
  return applications.get(id);
}

export function resetExampleApplications(): void {
  applications.set('APP-1024', { status: 'submitted', paid: true });
}
