import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { compareEvalRuns, createEvalRunner, createFileEvalStore, evaluateGates, hashText, renderEvalReport, toEvalJson } from '@gixcopilot/evals';
import type { GateThresholds, ReproducibilitySnapshot } from '@gixcopilot/evals';
import { createOpenAIProvider } from '@gixcopilot/provider-openai';
import { createOpenAIEmbeddingProvider } from '@gixcopilot/rag';
import { createCostEstimator, createStaticPricingTable } from '@gixcopilot/telemetry';
import { SUPPORT_INSTRUCTIONS, applicationApprovalWorkflow, paymentAgent, supportAgent } from './agents.js';
import { applicationSupportDataset } from './dataset.js';
import { createDeterministicModels } from './models.js';
import { createSupportTarget } from './target.js';
import { createKnowledgeBase } from './tools.js';

/**
 * `pnpm eval` (Section 130): the Phase 11 CLI foundation is this script over the
 * `@gixcopilot/evals` API - the full `aicopilot eval` CLI belongs to Phase 12.
 *
 *   pnpm eval                              deterministic (no credentials, CI-safe)
 *   MODEL_PROVIDER=openai pnpm eval        real OpenAI through the existing provider adapter
 *   EVAL_REGRESSION_DEMO=1 pnpm eval       evaluate a misconfigured candidate against the baseline
 *   UPDATE_BASELINE=1 pnpm eval            store this run as the new baseline
 */
async function main(): Promise<void> {
  const apiKey = process.env['OPENAI_API_KEY'];
  const live = process.env['MODEL_PROVIDER'] === 'openai' && Boolean(apiKey);
  const modelName = process.env['OPENAI_MODEL'] || 'gpt-4o-mini';
  const regressionDemo = process.env['EVAL_REGRESSION_DEMO'] === '1';
  const repetitions = Number(process.env['EVAL_REPETITIONS'] ?? (live ? 3 : 1));
  const mode = live ? 'openai' : 'deterministic';
  const embeddingModel = process.env['OPENAI_EMBEDDING_MODEL'] || 'text-embedding-3-small';

  const snapshot: ReproducibilitySnapshot = {
    model: live ? { provider: 'openai', model: modelName } : { provider: 'test', model: 'deterministic-worst-case' },
    prompt: { id: 'support-instructions', version: supportAgent.metadata?.version ?? '1', hash: hashText(SUPPORT_INSTRUCTIONS) },
    agents: [supportAgent, paymentAgent].map((agent) => ({ id: agent.id, version: agent.metadata?.version, tools: agent.tools as readonly string[] | undefined })),
    workflows: [{ id: applicationApprovalWorkflow.id, version: applicationApprovalWorkflow.version, steps: applicationApprovalWorkflow.steps.map((step) => `${step.id}:${step.type}`) }],
    rag: live ? { retriever: 'in-memory-vector', topK: 3, embeddingModel, filters: { threshold: 0.3 } } : { retriever: 'in-memory-vector', topK: 3, embeddingModel: 'deterministic-embedding', filters: { threshold: 0 } },
    memory: { strategy: 'owner-scoped-durable', enabled: true },
    custom: { misconfigured: regressionDemo },
  };
  // Cost is an ESTIMATE from pricing you configure - nothing is hard-coded (Section 18, 119).
  const inputPrice = Number(process.env['EVAL_PRICE_INPUT_PER_MILLION']);
  const outputPrice = Number(process.env['EVAL_PRICE_OUTPUT_PER_MILLION']);
  const costEstimator = Number.isFinite(inputPrice) && Number.isFinite(outputPrice) && live
    ? createCostEstimator({ pricing: createStaticPricingTable({ [`openai/${modelName}`]: { inputPerMillion: inputPrice, outputPerMillion: outputPrice, source: 'EVAL_PRICE_* environment variables' } }) })
    : undefined;

  const runner = createEvalRunner({
    target: createSupportTarget({
      providers: () => (live ? [createOpenAIProvider({ apiKey })] : createDeterministicModels()),
      live: live ? { provider: 'openai', model: modelName } : undefined,
      misconfigured: regressionDemo,
      // Live mode uses the real configured knowledge pipeline (Section 204): OpenAI embeddings.
      retriever: live ? await createKnowledgeBase(createOpenAIEmbeddingProvider({ apiKey, model: embeddingModel })) : undefined,
      retrievalThreshold: live ? 0.3 : 0,
    }),
    snapshot,
    repetitions,
    costEstimator,
    telemetryMode: 'redacted',
    label: regressionDemo ? 'misconfigured-candidate' : mode,
  });

  console.log(`Running ${applicationSupportDataset.id}@${applicationSupportDataset.version} (${mode}${regressionDemo ? ', MISCONFIGURED candidate' : ''}, ${repetitions}x)...\n`);
  const run = await runner.run(applicationSupportDataset);

  const store = createFileEvalStore(join('.eval-results', mode));
  const baseline = await store.getBaseline(applicationSupportDataset.id);
  const comparison = baseline ? compareEvalRuns(baseline, run) : undefined;
  // Application-chosen thresholds; the security gate applies regardless (Section 131-132).
  const thresholds: GateThresholds = live
    ? { minimums: { 'tool-selection': 0.8, 'task-completion': 0.8 }, failOnRegression: false }
    : { minimums: { 'tool-selection': 1, 'task-completion': 1, 'agent-routing': 1 }, failOnRegression: true };
  const gate = evaluateGates(run, thresholds, comparison);

  console.log(renderEvalReport(run, { comparison, gate }));
  if (!regressionDemo) {
    await store.save(run);
    if (!baseline || process.env['UPDATE_BASELINE'] === '1') await store.setBaseline(applicationSupportDataset.id, run.id);
  }
  await mkdir('.eval-results', { recursive: true });
  await writeFile(join('.eval-results', `${mode}${regressionDemo ? '-regression-demo' : ''}-latest.json`), toEvalJson(run, { comparison, gate }), 'utf8');
  if (!gate.passed) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error('Eval run failed:', error);
  process.exitCode = 1;
});
