import { defineAgent } from '@gixcopilot/agents';

/**
 * A minimal agent invoked as a controlled workflow STEP (Section 91, 173-174) - not the
 * workflow's own decision-maker. It only summarizes; the actual approve/update decisions
 * stay entirely with the deterministic workflow steps around it (Section 82-83's "use a
 * workflow when the business process should be deterministic").
 */
export const applicationReviewAgent = defineAgent({
  id: 'application-review',
  name: 'Application Review Agent',
  description: 'Summarizes an application for a human reviewer.',
  instructions: 'Summarize the application status in one sentence for a supervisor to review.',
});
