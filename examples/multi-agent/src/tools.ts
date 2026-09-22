import { z } from 'zod';
import { defineTool } from '@gixcopilot/tools';

/** Real, deterministic state each specialist's own tool reads (Section 169) - never a
 * fixture matched against the question text. */
const applications = new Map<string, { status: string; applicantId: string }>([
  ['APP-1024', { status: 'under_review', applicantId: 'user-1' }],
]);
const payments = new Map<string, { verified: boolean; method: string }>([
  ['user-1', { verified: true, method: 'card' }],
]);
const policySnippets: Record<string, string> = {
  approval:
    'An application is approved once identity documents are confirmed and the payment method is verified.',
};

/** Only the Application specialist declares this. */
export const getApplicationTool = defineTool({
  name: 'applications.get',
  description: 'Look up an application by its id.',
  input: z.object({ id: z.string() }),
  execute: (input) => {
    const application = applications.get(input.id);
    return Promise.resolve(application ? { found: true, ...application } : { found: false });
  },
});

/**
 * Only the Payment specialist declares this - and it requires a permission a plain viewer
 * does not have, so this example can prove delegation never expands privilege (Section 172,
 * 186): the orchestrator delegating to the payment specialist must not let a viewer see
 * payment data they could not see directly.
 */
export const getPaymentTool = defineTool({
  name: 'payments.get',
  description: "Look up a user's payment verification status.",
  input: z.object({ userId: z.string() }),
  security: { requiredPermissions: ['payments.read'] },
  execute: (input) => {
    const payment = payments.get(input.userId);
    return Promise.resolve(payment ? { found: true, ...payment } : { found: false });
  },
});

/** Only the Knowledge specialist declares this. */
export const searchPolicyTool = defineTool({
  name: 'knowledge.search',
  description: 'Search policy documentation for a general question.',
  input: z.object({ topic: z.enum(['approval']) }),
  execute: (input) => Promise.resolve({ text: policySnippets[input.topic] }),
});
