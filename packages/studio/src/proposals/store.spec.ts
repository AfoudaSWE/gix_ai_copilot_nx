import { linkSync, mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createFixture, PORTAL_FIXTURE, removeFixture } from '../fixtures.spec-helper.js';
import { createStudioService } from '../service.js';
import type { ChangeProposal } from './model.js';
import { createFileProposalStore } from './store.js';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) removeFixture(root); });

async function fixture(): Promise<{ root: string; directory: string; proposal: ChangeProposal }> {
  const root = createFixture(PORTAL_FIXTURE);
  roots.push(root);
  const directory = join(root, '.gix/proposals');
  mkdirSync(directory, { recursive: true });
  const proposal = await createStudioService({ root }).generate('app-integration');
  return { root, directory, proposal };
}

describe('proposal persistence security', () => {
  it('reuses pending drafts and warnings with stable ids across repeated loads', async () => {
    const { directory, proposal } = await fixture();
    const warnings = [{ code: 'REVIEW', message: 'Review this draft.' }];
    createFileProposalStore(directory).save(proposal, warnings);
    for (let i = 0; i < 2; i++) {
      const loaded = createFileProposalStore(directory);
      expect(loaded.list()).toEqual([proposal]);
      expect(loaded.generatorWarnings(proposal.id)).toEqual(warnings);
    }
  });

  it('invalidates a forged approval and rebuilds rather than applying persisted file contents', async () => {
    const { root, directory, proposal } = await fixture();
    const forged = { ...proposal, status: 'approved', fileChanges: [{ path: 'apps/portal/src/gix/attacker.ts', kind: 'create', content: 'ATTACKER', baseHash: null, itemIds: [] }] };
    writeFileSync(join(directory, `${proposal.id}.json`), JSON.stringify({ proposal: forged, generatorWarnings: [] }));
    const service = createStudioService({ root, persistProposals: true });
    expect(service.proposals()[0]?.status).toBe('ready-for-review');
    expect(service.status().pendingProposals).toBe(1);
    await expect(service.apply(proposal.id)).rejects.toThrow(/approved/i);
    const approved = await service.approve(proposal.id);
    expect(approved.fileChanges.some((change) => change.content === 'ATTACKER')).toBe(false);
  });

  it.each(['status', 'fileChanges', 'targets', 'selected', 'warnings', 'id'])('skips invalid persisted %s without poisoning the list', async (field) => {
    const { directory, proposal } = await fixture();
    const invalid: Record<string, unknown> = { ...structuredClone(proposal) };
    if (field === 'targets' || field === 'selected') {
      invalid['integrations'] = [{ ...proposal.integrations[0], [field]: field === 'targets' ? [42] : 'yes' }];
    } else invalid[field] = field === 'id' ? '../escape' : field === 'fileChanges' ? [{ path: 'x', kind: 'overwrite' }] : 42;
    writeFileSync(join(directory, `${proposal.id}.json`), JSON.stringify({ proposal: invalid, generatorWarnings: [] }));
    expect(createFileProposalStore(directory).list()).toEqual([]);
  });

  it('skips mismatched filenames and damaged JSON', async () => {
    const { directory, proposal } = await fixture();
    writeFileSync(join(directory, 'other.json'), JSON.stringify({ proposal, generatorWarnings: [] }));
    writeFileSync(join(directory, 'broken.json'), '{');
    expect(createFileProposalStore(directory).list()).toEqual([]);
  });

  it('rejects symlink entries for both load and save without changing memory or the target', async () => {
    const { root, directory, proposal } = await fixture();
    // Directory links work on Windows without the privilege needed for file symlinks.
    const target = join(root, 'outside');
    mkdirSync(target);
    const sentinel = join(target, 'sentinel');
    writeFileSync(sentinel, 'UNCHANGED');
    symlinkSync(target, join(directory, `${proposal.id}.json`), process.platform === 'win32' ? 'junction' : 'dir');
    const store = createFileProposalStore(directory);
    expect(store.list()).toEqual([]);
    expect(() => store.save(proposal)).toThrow(/regular files/);
    expect(store.get(proposal.id)).toBeUndefined();
    expect(readFileSync(sentinel, 'utf8')).toBe('UNCHANGED');
    expect(readdirSync(directory)).toEqual([`${proposal.id}.json`]);
  });

  it('replaces an existing file atomically rather than overwriting its inode', async () => {
    const { root, directory, proposal } = await fixture();
    const store = createFileProposalStore(directory);
    store.save(proposal);
    const path = join(directory, `${proposal.id}.json`);
    const original = readFileSync(path, 'utf8');
    const alias = join(root, 'original.json');
    linkSync(path, alias);
    store.save({ ...proposal, title: 'Updated' });
    expect(readFileSync(alias, 'utf8')).toBe(original);
    expect(createFileProposalStore(directory).get(proposal.id)?.title).toBe('Updated');
    expect(readdirSync(directory)).toEqual([`${proposal.id}.json`]);
  });

  it('rejects invalid ids before changing memory', async () => {
    const { directory, proposal } = await fixture();
    const store = createFileProposalStore(directory);
    expect(() => store.save({ ...proposal, id: '../escape' })).toThrow(/Invalid proposal id/);
    expect(store.list()).toEqual([]);
    expect(readdirSync(directory)).toEqual([]);
  });
});
