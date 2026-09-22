import { z } from 'zod';
import { defineWorkflow } from '@gixcopilot/workflows';
import { agentStep, approvalStep, functionStep, toolStep } from '@gixcopilot/workflows';

export const stateSchema = z.object({
  applicationId: z.string(),
  validated: z.boolean(),
  agentSummary: z.string().optional(),
  paymentVerified: z.boolean(),
  approved: z.boolean(),
  updated: z.boolean(),
});
export type ApplicationApprovalState = z.infer<typeof stateSchema>;

/**
 * The deterministic business process (Section 82-83, 173-174): Validate -> Application Agent
 * -> Check Payment -> Prepare Change -> Supervisor Approval -> Update Application -> Complete.
 * Every consequential action (the final update) sits behind a real human approval - the
 * agent step only summarizes, it never decides or approves anything itself (Section 135).
 */
export function createApplicationApprovalWorkflow() {
  return defineWorkflow({
    id: 'application-approval',
    version: '1',
    input: z.object({ applicationId: z.string() }),
    state: stateSchema,
    initialState: (input) => ({
      applicationId: input.applicationId,
      validated: false,
      paymentVerified: false,
      approved: false,
      updated: false,
    }),
    steps: [
      functionStep<ApplicationApprovalState>({
        id: 'validate',
        run: ({ state }) => {
          if (!state.applicationId.trim()) throw new Error('applicationId is required.');
          return { ...state, validated: true };
        },
      }),
      agentStep<ApplicationApprovalState>({
        id: 'application-agent',
        dependencies: ['validate'],
        agent: 'application-review',
        input: ({ state }) => ({ message: `Summarize application ${state.applicationId}.` }),
        updateState: (state, output) => ({ ...state, agentSummary: String(output) }),
      }),
      toolStep<ApplicationApprovalState>({
        id: 'check-payment',
        dependencies: ['application-agent'],
        tool: 'payments.verify',
        input: ({ state }) => ({ applicationId: state.applicationId }),
        updateState: (state, output) => ({
          ...state,
          paymentVerified: (output as { verified: boolean }).verified,
        }),
      }),
      functionStep<ApplicationApprovalState>({
        id: 'prepare-change',
        dependencies: ['check-payment'],
        run: ({ state }) => {
          if (!state.paymentVerified) throw new Error('Cannot prepare an update without verified payment.');
          return state;
        },
      }),
      approvalStep<ApplicationApprovalState>({
        id: 'supervisor-approval',
        dependencies: ['prepare-change'],
        action: 'applications.update',
        summary: ({ state }) => `Approve application ${state.applicationId} (payment verified).`,
        approval: 'supervisor',
      }),
      toolStep<ApplicationApprovalState>({
        id: 'apply-update',
        dependencies: ['supervisor-approval'],
        tool: 'applications.update',
        input: ({ state }) => ({ applicationId: state.applicationId }),
        updateState: (state) => ({ ...state, approved: true, updated: true }),
      }),
    ],
  });
}
