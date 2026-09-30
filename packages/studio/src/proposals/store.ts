import { randomUUID } from 'node:crypto';
import { closeSync, constants, fstatSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import type { ChangeProposal, ProposalStatus } from './model.js';
import { summarize } from './model.js';

/** Allowed transitions (§51-52, §75). Anything else throws, so a proposal can't skip approval. */
const TRANSITIONS: Readonly<Record<ProposalStatus, readonly ProposalStatus[]>> = {
  draft: ['ready-for-review', 'rejected'],
  'ready-for-review': ['draft', 'ready-for-review', 'approved', 'rejected'],
  // A conflict found at apply time sends an approved proposal back to review.
  approved: ['applied', 'failed', 'ready-for-review'],
  // A rejected proposal stays available for editing or regeneration (§51).
  rejected: ['draft', 'ready-for-review'],
  applied: [],
  failed: [],
};

export class ProposalStateError extends Error {
  readonly from: ProposalStatus;
  readonly to: ProposalStatus;

  constructor(from: ProposalStatus, to: ProposalStatus) {
    super(from === 'applied' ? 'This proposal was already applied; generate a new one to make further changes.' : `A proposal cannot go from "${from}" to "${to}".`);
    this.name = 'ProposalStateError';
    this.from = from;
    this.to = to;
  }
}

export function assertTransition(from: ProposalStatus, to: ProposalStatus): void {
  if (!TRANSITIONS[from].includes(to)) throw new ProposalStateError(from, to);
}

export interface ProposalStore {
  /** `generatorWarnings` are kept so an edit can re-validate without re-running the generator. */
  save(proposal: ChangeProposal, generatorWarnings?: ChangeProposal['warnings']): void;
  get(id: string): ChangeProposal | undefined;
  list(): readonly ChangeProposal[];
  generatorWarnings(id: string): ChangeProposal['warnings'];
}

/** In-memory store for one Studio process. Proposals are development-session state. */
export function createProposalStore(): ProposalStore {
  const proposals = new Map<string, ChangeProposal>();
  const warnings = new Map<string, ChangeProposal['warnings']>();
  return {
    save(proposal, generatorWarnings) {
      const current = proposals.get(proposal.id);
      if (current && current.status !== proposal.status) assertTransition(current.status, proposal.status);
      proposals.set(proposal.id, proposal);
      if (generatorWarnings) warnings.set(proposal.id, generatorWarnings);
    },
    get: (id) => proposals.get(id),
    list: () => [...proposals.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    generatorWarnings: (id) => warnings.get(id) ?? [],
  };
}

interface StoredProposal {
  readonly proposal: ChangeProposal;
  readonly generatorWarnings: ChangeProposal['warnings'];
}

const strings = z.array(z.string());
const item = { id: z.string(), selected: z.boolean() };
const risk = z.enum(['read-only', 'write', 'destructive']);
const approval = z.enum(['none', 'user-confirmation', 'supervisor', 'admin', 'two-person']);
const warning = z.object({ code: z.string(), message: z.string(), itemId: z.string().optional() });
// Persisted data is a draft, never evidence that review or approval took place.
const storedSchema = z.object({
  generatorWarnings: z.array(warning),
  proposal: z.object({
    id: z.string().regex(/^[\w-]+$/), generator: z.string(), title: z.string(), createdAt: z.iso.datetime(), updatedAt: z.iso.datetime(),
    status: z.enum(['draft', 'ready-for-review', 'approved', 'rejected', 'applied', 'failed']),
    tools: z.array(z.object({ ...item, name: z.string(), description: z.string(), operation: z.object({ method: z.string(), path: z.string(), source: z.string(), file: z.string(), key: z.string() }), suggestedRisk: risk, risk, permission: z.string().optional(), approval, enabled: z.boolean(), agent: z.string().optional(), inputSchema: z.record(z.string(), z.unknown()), confidence: z.enum(['high', 'medium', 'review']).optional(), conflicts: strings.optional() })),
    context: z.array(z.object({ ...item, name: z.string(), kind: z.enum(['user', 'route', 'entity', 'tenant', 'permissions', 'state']), description: z.string(), sensitivity: z.enum(['public', 'internal', 'sensitive', 'restricted']), source: z.object({ file: z.string(), line: z.number().int().positive().optional() }), app: z.string().optional(), page: z.object({ route: z.string(), component: z.string().optional(), params: strings, entity: z.string().optional(), context: strings, relevantTools: strings }).optional() })),
    integrations: z.array(z.object({ ...item, kind: z.literal('ui'), app: z.string(), framework: z.enum(['react', 'angular', 'vue', 'nextjs']), description: z.string(), gixDir: z.string(), typescript: z.boolean(), targets: strings, manual: strings })),
    ui: z.array(z.object({ ...item, name: z.string(), description: z.string(), framework: z.enum(['react', 'angular', 'vue']), file: z.string(), props: z.array(z.object({ name: z.string(), type: z.string(), optional: z.boolean() })) })),
    agents: z.array(z.object({ ...item, name: z.string(), description: z.string(), instructions: z.string(), tools: strings })),
    skills: z.array(z.object({ ...item, name: z.string(), description: z.string(), tools: strings, steps: strings })),
    knowledge: z.array(z.object({ ...item, name: z.string(), description: z.string(), sources: z.array(z.object({ path: z.string(), kind: z.string() })) })),
    policies: z.array(z.object({ ...item, tool: z.string(), requiredPermissions: strings, approval, risk })),
    configChanges: z.array(z.object({ ...item, file: z.string(), key: z.string(), before: z.unknown().optional(), after: z.unknown() })),
    fileChanges: z.array(z.object({ path: z.string(), kind: z.enum(['create', 'modify', 'delete']), content: z.string().optional(), baseHash: z.string().regex(/^[a-f0-9]{64}$/).nullable(), itemIds: strings })),
    diagnostics: z.array(z.object({ severity: z.enum(['info', 'warning', 'error']), code: z.string(), message: z.string(), file: z.string().optional() })),
    warnings: z.array(warning), conflicts: z.array(z.object({ path: z.string(), message: z.string() })),
    securityReview: z.array(warning.extend({ severity: z.enum(['error', 'warning']), path: z.string().optional() })),
    applyResult: z.object({ appliedAt: z.iso.datetime(), written: strings, removed: strings, rolledBack: z.boolean(), validation: z.array(z.object({ name: z.enum(['configuration', 'typecheck', 'lint', 'test', 'build', 'security', 'integration']), status: z.enum(['passed', 'failed', 'skipped']), detail: z.string().optional() })), outcome: z.enum(['complete', 'applied-with-validation-errors', 'aborted']), message: z.string() }).optional(),
  }),
});

function assertRegularFile(path: string): void {
  try {
    if (!lstatSync(path).isFile()) throw new Error('Proposal files must be regular files, not symlinks.');
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
  }
}

/**
 * A store that also writes each proposal to `<directory>/<id>.json` (§57-60), so proposals made
 * by `gix init` are the ones the Studio shows. Approval never survives a restart. Proposal files
 * hold generated code (secret-scanned) and review state, never secrets.
 */
export function createFileProposalStore(directory: string): ProposalStore {
  const memory = createProposalStore();
  directory = resolve(directory);
  mkdirSync(directory, { recursive: true });
  for (const file of readdirSync(directory).filter((name) => /^[\w-]+\.json$/.test(name))) {
    try {
      const path = join(directory, file);
      assertRegularFile(path);
      const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
      let stored;
      try {
        if (!fstatSync(fd).isFile()) continue;
        stored = storedSchema.parse(JSON.parse(readFileSync(fd, 'utf8')));
      } finally {
        closeSync(fd);
      }
      if (`${stored.proposal.id}.json` !== file) continue;
      const { applyResult, ...draft } = stored.proposal;
      const proposal: ChangeProposal = { ...draft, status: draft.status === 'approved' ? 'ready-for-review' : draft.status, summary: summarize(draft), ...((draft.status === 'applied' || draft.status === 'failed') && applyResult ? { applyResult } : {}) };
      memory.save(proposal, stored.generatorWarnings);
    } catch {
      // A damaged file is skipped; the proposal can be regenerated.
    }
  }
  return {
    ...memory,
    save(proposal, generatorWarnings) {
      if (!/^[\w-]+$/.test(proposal.id)) throw new Error('Invalid proposal id.');
      const current = memory.get(proposal.id);
      if (current && current.status !== proposal.status) assertTransition(current.status, proposal.status);
      const stored: StoredProposal = { proposal, generatorWarnings: generatorWarnings ?? memory.generatorWarnings(proposal.id) };
      const path = join(directory, `${proposal.id}.json`);
      assertRegularFile(path);
      const temporary = join(directory, `.${proposal.id}.${randomUUID()}.tmp`);
      const fd = openSync(temporary, 'wx', 0o600);
      try {
        try {
          writeFileSync(fd, `${JSON.stringify(stored, null, 2)}\n`);
        } finally {
          closeSync(fd);
        }
        assertRegularFile(path);
        renameSync(temporary, path);
      } finally {
        try { unlinkSync(temporary); } catch (error) {
          if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
        }
      }
      memory.save(proposal, generatorWarnings);
    },
  };
}
