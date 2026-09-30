import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { classifyProject, compareDiscoveries, createReadonlyWorkspace, discoverProject } from '@gixcopilot/studio';
import type { DiscoveredProject } from '@gixcopilot/studio';
import type { InitIo } from './init.js';
import { MANIFEST_FILE, parseManifest } from './manifest.js';
import type { InstallStep } from './plan.js';
import { SERVER_FILE } from './templates.js';

/** Runs a package-manager command. Command and arguments come from `planInstalls`, never from free input. */
export function runInstall(step: InstallStep, cwd: string): Promise<number> {
  return new Promise((resolve) => {
    // Windows package-manager shims are .cmd files, which need a shell (the repo-wide convention).
    const child = spawn(step.command, [...step.args], { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
    child.on('error', () => resolve(1));
    child.on('close', (code) => resolve(code ?? 1));
  });
}

/** `gix dev`: runs gix/server.ts with tsx, loading .env when present. */
export function runDev(io: Pick<InitIo, 'cwd' | 'err'>, env: NodeJS.ProcessEnv = process.env): Promise<number> {
  const server = join(io.cwd, SERVER_FILE);
  if (!existsSync(server)) {
    io.err(`${SERVER_FILE} not found. Run \`npx gix init\` first.`);
    return Promise.resolve(1);
  }
  const tsx = createRequire(import.meta.url).resolve('tsx/cli');
  const args = [tsx, ...(existsSync(join(io.cwd, '.env')) ? ['--env-file=.env'] : []), SERVER_FILE];
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { cwd: io.cwd, stdio: 'inherit', env: { ...env, NODE_ENV: env['NODE_ENV'] ?? 'development' } });
    child.on('error', () => resolve(1));
    child.on('close', (code) => resolve(code ?? 1));
  });
}

/** `gix status` (§57, §59): the installation, and what changed since the last discovery. */
export async function runStatus(io: Pick<InitIo, 'cwd' | 'out' | 'err'>): Promise<number> {
  const manifestPath = join(io.cwd, MANIFEST_FILE);
  const manifest = existsSync(manifestPath) ? parseManifest(readFileSync(manifestPath, 'utf8')) : undefined;
  if (!manifest) {
    io.err('GIX is not set up here. Run `npx gix init`.');
    return 1;
  }
  const current = await discoverProject(createReadonlyWorkspace(io.cwd));
  const classification = classifyProject(current);
  io.out(`GIX ${manifest.sdkVersion} · ${classification.classification} · set up ${manifest.createdAt}`);
  io.out(`Copilot apps: ${manifest.selectedApplications.join(', ') || 'none selected'}`);
  const snapshotPath = join(io.cwd, '.gix', 'discovery.json');
  if (existsSync(snapshotPath)) {
    const previous = JSON.parse(readFileSync(snapshotPath, 'utf8')) as DiscoveredProject;
    const comparison = compareDiscoveries(previous, current);
    if (comparison.unchanged) io.out('No changes since the last discovery.');
    else {
      io.out(`${String(comparison.newApis.length)} new API(s), ${String(comparison.changedApis.length)} changed, ${String(comparison.removedApis.length)} removed`);
      io.out(`${String(comparison.newComponents.length)} new component(s), ${String(comparison.newPermissions.length)} new permission(s), ${String(comparison.newContextCandidates.length)} new context candidate(s)`);
      io.out('Open /__gix and use Sync Copilot to review proposals for these changes.');
    }
  }
  return 0;
}
