import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { DetectedCommand, DetectedCommands } from '../discovery/model.js';
import { assertApplicationPlane } from '../planes.js';
import type { ApplyResult, ChangeProposal, FileChange, ProposalConflict, ValidationCheck } from '../proposals/model.js';
import { summarize } from '../proposals/model.js';
import { reviewProposalSecurity } from '../proposals/security-review.js';
import { assertTransition } from '../proposals/store.js';
import { isSecretPath } from '../workspace/guard.js';
import type { WorkspaceGuard } from '../workspace/guard.js';
import { sha256 } from '../workspace/workspace.js';
import { redactSecrets, scanForSecrets } from './secret-scan.js';

export type ValidationStep = 'typecheck' | 'lint' | 'test' | 'build';

/** Runs one detected project command. Injectable so tests need not spawn real processes. */
export type CommandRunner = (command: DetectedCommand, options: { readonly cwd: string; readonly timeoutMs: number; readonly signal?: AbortSignal }) => Promise<{ readonly exitCode: number; readonly output: string }>;

export interface ApplyEngineOptions {
  readonly guard: WorkspaceGuard;
  /** Commands from discovery (§58: the project's own commands; `pnpm` is never assumed). */
  readonly commands: () => DetectedCommands;
  /** Which checks run after apply. Default: typecheck, lint, test. */
  readonly validationSteps?: readonly ValidationStep[];
  readonly runner?: CommandRunner;
  readonly commandTimeoutMs?: number;
}

export interface ApplyEngine {
  /** Applies an **approved** proposal. Returns the proposal in its new state. */
  apply(proposal: ChangeProposal, options?: { readonly signal?: AbortSignal }): Promise<ChangeProposal>;
  /** Restores the files of the last apply of this proposal, if none of them changed since. */
  rollback(proposal: ChangeProposal): Promise<{ readonly restored: readonly string[]; readonly skipped: readonly string[] }>;
}

export class ApplyRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ApplyRefusedError';
  }
}

/** Default runner: spawns the detected command with fixed arguments and no user input. */
export const spawnCommandRunner: CommandRunner = (command, { cwd, timeoutMs, signal }) =>
  new Promise((resolve) => {
    // Windows package-manager shims are .cmd files, which need a shell. The command and its
    // arguments come from a fixed allowlist (package manager + script name), never from input.
    const child = spawn(command.command, [...command.args], { cwd, shell: process.platform === 'win32', env: { ...process.env, CI: 'true', FORCE_COLOR: '0' }, signal, timeout: timeoutMs });
    let output = '';
    const collect = (chunk: Buffer): void => {
      output = (output + chunk.toString('utf8')).slice(-8000);
    };
    child.stdout?.on('data', collect);
    child.stderr?.on('data', collect);
    child.on('error', (error) => resolve({ exitCode: 1, output: `${output}\n${error.message}` }));
    child.on('close', (code) => resolve({ exitCode: code ?? 1, output }));
  });

interface Backup {
  readonly path: string;
  readonly absolute: string;
  readonly original: Buffer | null;
  readonly writtenHash: string | null;
}

/**
 * The deterministic apply engine (§53-60). It is the only component that writes to the
 * repository, and it accepts nothing but an approved proposal. The model never writes files.
 */
export function createApplyEngine(options: ApplyEngineOptions): ApplyEngine {
  const { guard } = options;
  const runner = options.runner ?? spawnCommandRunner;
  const steps = options.validationSteps ?? ['typecheck', 'lint', 'test'];
  const history = new Map<string, readonly Backup[]>();

  const currentHash = async (absolute: string): Promise<string | null> => {
    try {
      return sha256(await readFile(absolute));
    } catch {
      return null;
    }
  };

  async function postValidate(proposal: ChangeProposal, written: readonly FileChange[], signal?: AbortSignal): Promise<ValidationCheck[]> {
    const checks: ValidationCheck[] = [];
    const config = written.find((change) => change.path.endsWith('.json'));
    if (config) {
      try {
        JSON.parse(await readFile(guard.resolve(config.path), 'utf8'));
        checks.push({ name: 'configuration', status: 'passed' });
      } catch {
        checks.push({ name: 'configuration', status: 'failed', detail: `${config.path} is not valid JSON.` });
      }
    }
    const commands = options.commands();
    for (const step of steps) {
      const command = commands[step];
      if (!command) {
        checks.push({ name: step, status: 'skipped', detail: `No "${step}" script was detected in package.json.` });
        continue;
      }
      const result = await runner(command, { cwd: guard.root, timeoutMs: options.commandTimeoutMs ?? 600_000, ...(signal ? { signal } : {}) });
      checks.push({ name: step, status: result.exitCode === 0 ? 'passed' : 'failed', detail: `${command.command} ${command.args.join(' ')}${result.exitCode === 0 ? '' : `\n${redactSecrets(result.output).trim().slice(-2000)}`}` });
    }
    const leaked = [];
    for (const change of written) {
      const text = await readFile(guard.resolve(change.path), 'utf8').catch(() => '');
      if (scanForSecrets(text).length > 0) leaked.push(change.path);
    }
    checks.push(leaked.length === 0 ? { name: 'security', status: 'passed' } : { name: 'security', status: 'failed', detail: `Possible secrets in ${leaked.join(', ')}.` });
    try {
      assertApplicationPlane(proposal.tools.filter((tool) => tool.selected));
      checks.push({ name: 'integration', status: 'passed', detail: 'No development-plane capability is exposed as an application tool.' });
    } catch (error) {
      checks.push({ name: 'integration', status: 'failed', detail: error instanceof Error ? error.message : String(error) });
    }
    return checks;
  }

  return {
    async apply(proposal, applyOptions = {}) {
      if (proposal.status !== 'approved') {
        throw new ApplyRefusedError(proposal.status === 'applied' ? 'This proposal was already applied.' : `Only an approved proposal can be applied (status: ${proposal.status}).`);
      }
      // Approval must still hold: re-run the security review on exactly what will be written.
      const review = reviewProposalSecurity(proposal, proposal.fileChanges);
      const blocking = review.filter((finding) => finding.severity === 'error');
      if (blocking.length > 0) throw new ApplyRefusedError(`Security review failed: ${blocking.map((finding) => finding.message).join(' ')}`);

      // Workspace protection (§54) and secret protection (§55), before touching anything.
      const targets = proposal.fileChanges.map((change) => {
        const absolute = guard.resolve(change.path);
        if (isSecretPath(absolute)) throw new ApplyRefusedError(`Refusing to write a secret file: ${change.path}.`);
        if (change.content !== undefined && scanForSecrets(change.content).length > 0) throw new ApplyRefusedError(`Possible secret in ${change.path}; nothing was written.`);
        return { change, absolute };
      });

      // Conflict detection (§56): a file changed since generation stops the apply.
      const conflicts: ProposalConflict[] = [];
      for (const { change, absolute } of targets) {
        const now = await currentHash(absolute);
        if (now !== change.baseHash) {
          conflicts.push({ path: change.path, message: change.baseHash === null ? 'The file was created after this proposal was generated.' : now === null ? 'The file was deleted after this proposal was generated.' : 'The file changed after this proposal was generated.' });
        }
      }
      const at = new Date().toISOString();
      if (conflicts.length > 0) {
        assertTransition(proposal.status, 'ready-for-review');
        const applyResult: ApplyResult = { appliedAt: at, written: [], removed: [], rolledBack: false, validation: [], outcome: 'aborted', message: `Nothing was written: ${String(conflicts.length)} file(s) changed since generation. Regenerate, or deselect the conflicting items, and approve again.` };
        return { ...proposal, status: 'ready-for-review', conflicts, applyResult, updatedAt: at, summary: summarize({ ...proposal, conflicts }) };
      }

      // Transactional apply (§57): back up, write each file atomically, roll back on failure.
      const backups: Backup[] = [];
      const createdDirectories: string[] = [];
      try {
        for (const { change, absolute } of targets) {
          const original = await readFile(absolute).catch(() => null);
          if (change.kind === 'delete') {
            backups.push({ path: change.path, absolute, original, writtenHash: null });
            await rm(absolute, { force: true });
            continue;
          }
          const directory = dirname(absolute);
          const made = await mkdir(directory, { recursive: true });
          if (made) createdDirectories.push(made);
          const temporary = `${absolute}.gix-${randomUUID()}.tmp`;
          await writeFile(temporary, change.content ?? '', { flag: 'wx' });
          backups.push({ path: change.path, absolute, original, writtenHash: sha256(change.content ?? '') });
          await rename(temporary, absolute);
        }
      } catch (error) {
        for (const backup of backups.reverse()) {
          if (backup.original === null) await rm(backup.absolute, { force: true });
          else await writeFile(backup.absolute, backup.original);
        }
        for (const directory of createdDirectories) await rm(directory, { recursive: true, force: true }).catch(() => undefined);
        assertTransition(proposal.status, 'failed');
        const message = error instanceof Error ? error.message : String(error);
        return { ...proposal, status: 'failed', updatedAt: at, applyResult: { appliedAt: at, written: [], removed: [], rolledBack: true, validation: [], outcome: 'aborted', message: `Writing failed and every change was rolled back: ${message}` } };
      }
      history.set(proposal.id, backups);

      // Post-apply validation (§58-60). Never claims success when a check failed.
      const written = proposal.fileChanges.filter((change) => change.kind !== 'delete');
      const validation = await postValidate(proposal, written, applyOptions.signal);
      const failed = validation.filter((check) => check.status === 'failed');
      const status = failed.length === 0 ? 'applied' : 'failed';
      assertTransition(proposal.status, status);
      const applyResult: ApplyResult = {
        appliedAt: at,
        written: written.map((change) => change.path),
        removed: proposal.fileChanges.filter((change) => change.kind === 'delete').map((change) => change.path),
        rolledBack: false,
        validation,
        outcome: failed.length === 0 ? 'complete' : 'applied-with-validation-errors',
        message: failed.length === 0 ? 'APPLY COMPLETE' : `APPLIED WITH VALIDATION ERRORS: ${failed.map((check) => check.name).join(', ')} failed. The files are in place; review the output, fix forward, or roll back this apply.`,
      };
      return { ...proposal, status, updatedAt: at, applyResult };
    },
    async rollback(proposal) {
      const backups = history.get(proposal.id);
      if (!backups) throw new ApplyRefusedError('There is no apply of this proposal to roll back in this Studio session.');
      const restored: string[] = [];
      const skipped: string[] = [];
      for (const backup of [...backups].reverse()) {
        // Only undo our own write: if the developer edited the file since, leave it alone.
        if ((await currentHash(backup.absolute)) !== backup.writtenHash) {
          skipped.push(backup.path);
          continue;
        }
        if (backup.original === null) await rm(backup.absolute, { force: true });
        else await writeFile(backup.absolute, backup.original);
        restored.push(backup.path);
      }
      history.delete(proposal.id);
      return { restored, skipped };
    },
  };
}
