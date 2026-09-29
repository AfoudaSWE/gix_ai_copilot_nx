import type { DiscoveredProject } from '../discovery/model.js';
import type { ProposalItems, ProposalWarning } from '../proposals/model.js';
import type { ReadonlyWorkspace } from '../workspace/workspace.js';

/**
 * What every generator gets (§30, §65-66). There is deliberately no writer here: a generator
 * sees the repository only through `ReadonlyWorkspace`, so `generate()` cannot mutate it.
 * Only the apply engine holds a writer, and it accepts only an approved proposal. ESLint
 * additionally forbids generator modules from importing the apply engine.
 */
export interface GeneratorContext {
  readonly workspace: ReadonlyWorkspace;
  readonly discovery: DiscoveredProject;
  readonly signal?: AbortSignal;
}

/** Developer choices made before generation, e.g. which operations to turn into tools (§32). */
export interface GeneratorInput {
  /** Ids/keys to include (operation ids, component names, context names, doc paths...). Empty = all candidates. */
  readonly select?: readonly string[];
  /** Generator-specific values, e.g. configuration changes. */
  readonly values?: Readonly<Record<string, unknown>>;
}

export interface GeneratedDraft extends ProposalItems {
  readonly title: string;
  readonly warnings: readonly ProposalWarning[];
}

/** A file a generator wants to exist, rendered from the current (possibly edited) items. */
export interface RenderedFile {
  readonly path: string;
  /** `undefined` requests deletion of a previously generated file. */
  readonly content: string | undefined;
  readonly itemIds: readonly string[];
}

export interface Generator<TAnalysis = unknown> {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  /** DISCOVER → ANALYZE: reads discovery data (and, if needed, files) and decides what is possible. */
  analyze(context: GeneratorContext, input: GeneratorInput): Promise<TAnalysis>;
  /** RECOMMEND → GENERATE PROPOSAL: structured items only. Never writes. */
  generate(analysis: TAnalysis, context: GeneratorContext): Promise<GeneratedDraft>;
  /**
   * Renders files from the items. Called again after every edit/selection change, so the
   * preview and diff always match exactly what apply would write. Must be deterministic.
   */
  render(items: ProposalItems, context: Pick<GeneratorContext, 'workspace'>): Promise<readonly RenderedFile[]>;
  /** VALIDATE PROPOSAL: generator-specific checks on the (possibly edited) items. */
  validate(items: ProposalItems): readonly ProposalWarning[];
}

export type AnyGenerator = Generator<unknown>;
