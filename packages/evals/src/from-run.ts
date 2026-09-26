import { projectSession } from '@gixcopilot/devtools';
import type { DiagnosticsSnapshot } from '@gixcopilot/devtools';
import { buildExecutionRecord } from './record.js';
import type { EvalCase, EvalRun, HumanLabel } from './types.js';

/**
 * Turns an inspected run into a regression case (Section 138-140): the tools it called, the
 * sources it retrieved, the agents involved and its outcome become the case's expectations.
 * Only names, ids and outcomes are copied - never payloads, arguments or retrieved text - so
 * the case is sanitized by construction (Section 139). The caller supplies `input`, typically
 * the user message it can already see.
 */
export function createEvalCaseFromRun<TInput>(options: {
  readonly snapshot: DiagnosticsSnapshot;
  readonly id: string;
  readonly input: TInput;
  /** Tools that must never run for this request, e.g. the one a bug wrongly called. */
  readonly forbiddenTools?: readonly string[];
  readonly tags?: readonly string[];
}): EvalCase<TInput> {
  const record = buildExecutionRecord({ session: projectSession(options.snapshot), caseId: options.id, repetition: 1, target: {}, latencyMs: 0 });
  const executed = [...new Set(record.tools.filter((tool) => tool.executed).map((tool) => tool.name))];
  const sources = [...new Set(record.retrievedSources.map((source) => source.sourceId))];
  const rootAgent = record.agents.find((agent) => agent.depth === 0)?.agentId;
  return {
    id: options.id,
    input: options.input,
    tags: [...(options.tags ?? []), 'from-run'],
    expected: {
      outcome: record.outcome,
      ...(executed.length ? { tools: executed } : {}),
      ...(options.forbiddenTools?.length ? { forbiddenTools: options.forbiddenTools } : {}),
      ...(sources.length ? { sources } : {}),
      ...(rootAgent ? { agent: rootAgent } : {}),
      ...(record.delegations.length ? { delegations: [...new Set(record.delegations.map((delegation) => delegation.to))] } : {}),
    },
    metadata: { sourceRunIds: record.runIds },
  };
}

/** Attaches human labels (Section 136) to a run - data only, no annotation workflow. */
export function withHumanLabels(run: EvalRun, labels: readonly HumanLabel[]): EvalRun {
  const known = new Set(run.results.map((result) => result.caseId));
  const unknown = labels.filter((label) => !known.has(label.caseId));
  if (unknown.length > 0) throw new Error(`Labels reference unknown cases: ${unknown.map((label) => label.caseId).join(', ')}.`);
  return { ...run, humanLabels: [...(run.humanLabels ?? []), ...labels] };
}

export function summarizeHumanLabels(run: EvalRun): Readonly<Record<HumanLabel['label'], number>> {
  const counts: Record<HumanLabel['label'], number> = { correct: 0, incorrect: 0, 'partially-correct': 0, unsafe: 0, 'needs-review': 0 };
  for (const label of run.humanLabels ?? []) counts[label.label] += 1;
  return counts;
}

/** Stable, dependency-free content hash for prompt/instruction version tracking (Section 142). */
export function hashText(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
