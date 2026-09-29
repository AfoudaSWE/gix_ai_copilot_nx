import type { ChangeProposal, ProposalStatus } from './model.js';

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
  save(proposal: ChangeProposal): void;
  get(id: string): ChangeProposal | undefined;
  list(): readonly ChangeProposal[];
}

/** In-memory store for one Studio process. Proposals are development-session state. */
export function createProposalStore(): ProposalStore {
  const proposals = new Map<string, ChangeProposal>();
  return {
    save(proposal) {
      const current = proposals.get(proposal.id);
      if (current && current.status !== proposal.status) assertTransition(current.status, proposal.status);
      proposals.set(proposal.id, proposal);
    },
    get: (id) => proposals.get(id),
    list: () => [...proposals.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
  };
}
