import type { EvalTarget } from '@gixcopilot/evals';
import type { ModelProvider } from '@gixcopilot/provider';
import type { Retriever } from '@gixcopilot/rag';
import { createSupportCopilot } from './app.js';
import type { SupportCopilotOptions } from './app.js';
import { USERS } from './data.js';
import type { CaseInput } from './dataset.js';
import { createKnowledgeBase, createMemory } from './tools.js';

/**
 * The eval target (Section 223): builds the REAL application per case against the runner's
 * recording telemetry, runs the case, and reports only the answer - everything else the
 * evaluators judge is read from what the runtime recorded.
 */
export function createSupportTarget(options: {
  readonly providers: () => readonly ModelProvider[];
  readonly live?: SupportCopilotOptions['live'];
  readonly misconfigured?: boolean;
  /** Shared, read-only knowledge base (e.g. built once with real embeddings for live runs). */
  readonly retriever?: Retriever;
  readonly retrievalThreshold?: number;
}): EvalTarget<CaseInput> {
  return async (evalCase, { telemetry, signal }) => {
    const copilot = await createSupportCopilot({
      telemetry,
      user: USERS[evalCase.input.user ?? 'applicant'],
      providers: options.providers(),
      live: options.live,
      misconfigured: options.misconfigured,
      retriever: options.retriever ?? (await createKnowledgeBase()),
      retrievalThreshold: options.retrievalThreshold,
      memory: await createMemory(),
    });
    if (evalCase.input.workflow) {
      const checkpoint = await copilot.startApprovalWorkflow(evalCase.input.workflow.applicationId);
      return { status: checkpoint.status === 'failed' ? 'failed' : 'completed', output: checkpoint.state };
    }
    const { result } = await copilot.ask(evalCase.input.message ?? '', signal);
    return result.status === 'completed'
      ? { answer: String(result.output), status: 'completed' }
      : { status: result.status, error: result.error };
  };
}
