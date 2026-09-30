import { randomUUID } from 'node:crypto';
import type { ChangeProposal, FileChange, ProposalItems } from '../proposals/model.js';
import { summarize } from '../proposals/model.js';
import { reviewProposalSecurity } from '../proposals/security-review.js';
import type { ReadonlyWorkspace } from '../workspace/workspace.js';
import type { AnyGenerator, GeneratorContext, GeneratorInput, RenderedFile } from './contract.js';

/**
 * Turns rendered files into `FileChange`s, recording each file's hash as it is now (§56).
 * A path already in the proposal keeps the hash from generation time, so a later external
 * edit is still detected as a conflict at apply time.
 */
async function toFileChanges(workspace: ReadonlyWorkspace, rendered: readonly RenderedFile[], previous: readonly FileChange[]): Promise<FileChange[]> {
  const known = new Map(previous.map((change) => [change.path, change.baseHash]));
  const changes: FileChange[] = [];
  for (const file of rendered) {
    const baseHash = known.has(file.path) ? (known.get(file.path) ?? null) : await workspace.hash(file.path);
    if (file.content === undefined) {
      if (baseHash !== null) changes.push({ path: file.path, kind: 'delete', baseHash, itemIds: file.itemIds });
      continue;
    }
    changes.push({ path: file.path, kind: baseHash === null ? 'create' : 'modify', content: file.content, baseHash, itemIds: file.itemIds });
  }
  return changes;
}

/** VALIDATE PROPOSAL → SECURITY REVIEW → ready for PREVIEW (§31). */
export async function buildProposal(
  generator: AnyGenerator,
  workspace: ReadonlyWorkspace,
  base: Pick<ChangeProposal, 'id' | 'title' | 'createdAt' | 'diagnostics'> & { readonly generatorWarnings: ChangeProposal['warnings'] },
  items: ProposalItems,
  previousFiles: readonly FileChange[],
): Promise<ChangeProposal> {
  const fileChanges = await toFileChanges(workspace, await generator.render(items, { workspace }), previousFiles);
  const warnings = [...base.generatorWarnings, ...generator.validate(items)];
  const securityReview = reviewProposalSecurity(items, fileChanges, generator.allowedPaths);
  const blocked = securityReview.some((finding) => finding.severity === 'error');
  return {
    id: base.id,
    generator: generator.id,
    title: base.title,
    createdAt: base.createdAt,
    updatedAt: new Date().toISOString(),
    status: blocked ? 'draft' : 'ready-for-review',
    ...items,
    fileChanges,
    diagnostics: base.diagnostics,
    warnings,
    conflicts: [],
    securityReview,
    summary: summarize({ ...items, fileChanges, warnings, conflicts: [], securityReview }),
  };
}

/**
 * Runs one generator end to end (§31): analyze → generate → render → validate → security
 * review. Returns a proposal. The repository is only read, never written.
 */
export async function runGenerator(generator: AnyGenerator, context: GeneratorContext, input: GeneratorInput = {}): Promise<{ readonly proposal: ChangeProposal; readonly generatorWarnings: ChangeProposal['warnings'] }> {
  const analysis = await generator.analyze(context, input);
  context.signal?.throwIfAborted();
  const draft = await generator.generate(analysis, context);
  const { title, warnings, ...items } = draft;
  const proposal = await buildProposal(generator, context.workspace, { id: randomUUID(), title, createdAt: new Date().toISOString(), diagnostics: context.discovery.diagnostics, generatorWarnings: warnings }, items, []);
  return { proposal, generatorWarnings: warnings };
}
