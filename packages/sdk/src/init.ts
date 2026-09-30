import { randomUUID } from 'node:crypto';
import { closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { classifyProject, createStudioService, createWorkspaceGuard, WorkspaceViolationError } from '@gixcopilot/studio';
import type { ChangeProposal, ClassifiedApplication, DiscoveredProject, ProjectClassificationResult, StudioService } from '@gixcopilot/studio';
import { MANIFEST_FILE, parseManifest } from './manifest.js';
import type { GixManifest } from './manifest.js';
import { planInstalls, SDK_VERSION } from './plan.js';
import type { InstallStep } from './plan.js';
import { ENV_EXAMPLE, GIX_GITIGNORE, MODULE_PACKAGE, SERVER_FILE, serverSource } from './templates.js';

export interface InitIo {
  readonly cwd: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  out(line: string): void;
  err(line: string): void;
  /** Asks the developer a question (interactive terminals only). */
  prompt?(question: string): Promise<string>;
  /** Runs one package-manager command; returns its exit code. */
  run(step: InstallStep, cwd: string): Promise<number>;
}

export interface InitOptions {
  /** Frontend apps (paths or names) that get the copilot. Default: the only one, or ask. */
  readonly apps?: readonly string[];
  /** Run package installs (default true). */
  readonly install?: boolean;
  /** Show what would happen; write and install nothing. */
  readonly dryRun?: boolean;
  /** Generate fresh proposals even when earlier ones are still pending. */
  readonly refresh?: boolean;
}

export interface InitResult {
  readonly exitCode: number;
  readonly classification: ProjectClassificationResult;
  readonly selected: readonly string[];
  readonly installs: readonly InstallStep[];
  readonly created: readonly string[];
  readonly kept: readonly string[];
  readonly proposals: readonly ChangeProposal[];
  readonly reusedProposals: readonly ChangeProposal[];
  readonly existing: boolean;
  readonly manifest?: GixManifest;
}

/** Generators `gix init` runs (§23-40). Everything they produce is a proposal to review. */
export const INIT_GENERATORS = ['app-integration', 'openapi-tools', 'api-tools', 'auth-security'] as const;

const METADATA_FILES = [MANIFEST_FILE, '.gix/discovery.json'] as const;

/** Metadata must be ordinary files under ordinary directories, never aliases to app files. */
function assertMetadataPath(root: string, path: string): void {
  const segments = path.split('/');
  let absolute = root;
  for (const [index, segment] of segments.entries()) {
    absolute = join(absolute, segment);
    let stat;
    try { stat = lstatSync(absolute); }
    catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return;
      throw error;
    }
    if (stat.isSymbolicLink()) throw new WorkspaceViolationError(path, 'metadata symbolic links and redirected parents are not accepted');
    if (index < segments.length - 1) {
      if (!stat.isDirectory()) throw new WorkspaceViolationError(path, 'metadata parent is not a directory');
    } else if (!stat.isFile() || stat.nlink !== 1) {
      throw new WorkspaceViolationError(path, 'metadata must be a regular file with no hard links');
    }
  }
}

/** Replace the entry, not its inode: even a linked destination must never be truncated. */
function writeMetadata(root: string, path: string, content: string): void {
  assertMetadataPath(root, path);
  const absolute = join(root, path);
  const temporary = join(dirname(absolute), `.metadata-${randomUUID()}.tmp`);
  const fd = openSync(temporary, 'wx', 0o600);
  try {
    try { writeFileSync(fd, content); }
    finally { closeSync(fd); }
    assertMetadataPath(root, path);
    renameSync(temporary, absolute);
  } finally { rmSync(temporary, { force: true }); }
}

function chooseApps(frontends: readonly ClassifiedApplication[], wanted: readonly string[] | undefined): ClassifiedApplication[] {
  if (!wanted) return [];
  return frontends.filter((app) => wanted.includes(app.path) || wanted.includes(app.name));
}

/** What `init` would generate for this project: only generators with something to propose. */
function generatorsFor(project: DiscoveredProject, classification: ProjectClassificationResult): string[] {
  const list: string[] = [];
  if (classification.frontends.length > 0) list.push('app-integration');
  if (project.operations.some((operation) => operation.primary.sourceKind === 'openapi')) list.push('openapi-tools');
  if (project.operations.some((operation) => operation.primary.sourceKind !== 'openapi')) list.push('api-tools');
  if (project.permissions.length > 0) list.push('auth-security');
  return list;
}

/**
 * `gix init` (§1, §2, §14, §41, §57). Detects the project, installs what the selected apps need,
 * creates only missing GIX-owned files, runs read-only discovery, and turns every change to
 * existing application source into a proposal to review at /__gix. It is safe to run again.
 */
export async function runInit(io: InitIo, options: InitOptions = {}): Promise<InitResult> {
  const guard = createWorkspaceGuard(io.cwd);
  const root = guard.root;
  if (!existsSync(guard.resolve('package.json'))) throw new Error('No package.json here. Run `gix init` at the root of your project.');
  for (const path of METADATA_FILES) assertMetadataPath(root, path);
  const dryRun = options.dryRun === true;
  const service: StudioService = createStudioService({ root, persistProposals: !dryRun });

  // --- Detect (read-only) -------------------------------------------------------------------
  const project = await service.discover();
  const classification = classifyProject(project);
  for (const path of METADATA_FILES) assertMetadataPath(root, path);
  const manifestPath = guard.resolve(MANIFEST_FILE);
  const previous = existsSync(manifestPath) ? parseManifest(readFileSync(manifestPath, 'utf8')) : undefined;

  // --- Choose apps (§52) -----------------------------------------------------------------------
  const frontends = classification.frontends.filter((app) => app.ui !== undefined);
  let wanted = options.apps ?? previous?.selectedApplications;
  if (!wanted && frontends.length === 1) wanted = [frontends[0]?.path ?? '.'];
  if (!wanted && frontends.length > 1 && io.prompt) {
    const answer = await io.prompt(`Which apps should get the copilot? ${frontends.map((app) => app.path).join(', ')} (comma-separated, empty for none): `);
    wanted = answer.split(',').map((entry) => entry.trim()).filter(Boolean);
  }
  const selected = chooseApps(frontends, wanted);

  // --- Install (§10) ----------------------------------------------------------------------------
  const installs = await planInstalls({ workspace: service.workspace, project, apps: selected, env: io.env });
  if (options.install !== false && !dryRun) {
    for (const step of installs) {
      io.out(`  ${step.command} ${step.args.join(' ')}   (${step.directory}, ${step.reason})`);
      const code = await io.run(step, step.directory === '.' ? root : guard.resolve(step.directory));
      if (code !== 0) {
        io.err(`Install failed in ${step.directory}. Nothing else was changed. Fix the install and run \`gix init\` again.`);
        return { exitCode: code, classification, selected: selected.map((app) => app.path), installs, created: [], kept: [], proposals: [], reusedProposals: [], existing: previous !== undefined };
      }
    }
  }

  // --- GIX-owned files: created when missing, never overwritten (§2, §57) -----------------------
  for (const path of METADATA_FILES) assertMetadataPath(root, path);
  const owned: Record<string, string> = {
    'gix/package.json': MODULE_PACKAGE,
    '.gix/package.json': MODULE_PACKAGE,
    [SERVER_FILE]: serverSource(project.workspace.name),
    'gix/.env.example': ENV_EXAMPLE,
    '.gix/.gitignore': GIX_GITIGNORE,
    '.gix/copilot.config.json': `${JSON.stringify({ copilot: { name: project.workspace.name } }, null, 2)}\n`,
  };
  const created: string[] = [];
  const kept: string[] = [];
  for (const [path, content] of Object.entries(owned)) {
    const absolute = guard.resolve(path);
    if (existsSync(absolute)) {
      kept.push(path);
      continue;
    }
    created.push(path);
    if (dryRun) continue;
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, content, { flag: 'wx' });
  }

  // --- Proposals (§23-44): pending ones are reused, not duplicated ------------------------------
  const pending = service.proposals().filter((proposal) => (proposal.status === 'draft' || proposal.status === 'ready-for-review') && (INIT_GENERATORS as readonly string[]).includes(proposal.generator));
  const proposals: ChangeProposal[] = [];
  if (pending.length === 0 || options.refresh === true) {
    for (const generator of generatorsFor(project, classification)) {
      if (generator === 'app-integration' && selected.length === 0) continue;
      const input = generator === 'app-integration' && selected.length > 0 ? { select: selected.map((app) => app.path) } : {};
      const proposal = await service.generate(generator, input);
      if (proposal.fileChanges.length > 0 || proposal.tools.length > 0 || proposal.integrations.length > 0 || proposal.policies.length > 0) proposals.push(proposal);
    }
  }

  // --- Manifest (§58) and discovery snapshot for `gix status` (§59) -----------------------------
  const now = new Date().toISOString();
  const all = [...pending, ...proposals];
  const manifest: GixManifest = {
    sdkVersion: SDK_VERSION,
    createdAt: previous?.createdAt ?? now,
    updatedAt: now,
    workspace: { kind: project.workspace.kind, packageManager: project.workspace.packageManager, classification: classification.classification },
    applications: classification.applications.map((app) => ({ path: app.path, role: app.role, ...((app.ui ?? app.backend) ? { framework: app.ui ?? app.backend } : {}) })),
    selectedApplications: selected.map((app) => app.path),
    server: { strategy: 'dedicated', file: SERVER_FILE, port: 4000 },
    uiIntegrations: all.flatMap((proposal) => proposal.integrations.filter((integration) => integration.selected).map((integration) => ({ app: integration.app, framework: integration.framework, proposal: proposal.id }))),
    generatedFiles: [...new Set([...(previous?.generatedFiles ?? []), ...created])],
    modifiedFiles: [...new Set(all.flatMap((proposal) => proposal.fileChanges.filter((change) => change.kind === 'modify').map((change) => change.path)))],
    apiSources: project.apis.filter((source) => source.kind !== 'frontend-client').map((source) => ({ kind: source.kind, file: source.file, operations: source.operations.length })),
    discovery: { discoveredAt: project.discoveredAt, operations: project.operations.length, routes: project.routes.length, pages: project.pages.length, components: project.components.length, permissions: project.permissions.length },
    proposals: all.map((proposal) => ({ id: proposal.id, generator: proposal.generator })),
  };
  if (!dryRun) {
    for (const path of METADATA_FILES) assertMetadataPath(root, path);
    writeMetadata(root, MANIFEST_FILE, `${JSON.stringify(manifest, null, 2)}\n`);
    writeMetadata(root, '.gix/discovery.json', `${JSON.stringify(project, null, 2)}\n`);
  }

  report(io, { project, classification, selected, installs, created, kept, pending, proposals, previous, dryRun, install: options.install !== false });
  return { exitCode: 0, classification, selected: selected.map((app) => app.path), installs, created, kept, proposals, reusedProposals: pending, existing: previous !== undefined, manifest };
}

/** The §41 summary. Every number comes from discovery or a proposal. */
function report(
  io: InitIo,
  data: {
    readonly project: DiscoveredProject;
    readonly classification: ProjectClassificationResult;
    readonly selected: readonly ClassifiedApplication[];
    readonly installs: readonly InstallStep[];
    readonly created: readonly string[];
    readonly kept: readonly string[];
    readonly pending: readonly ChangeProposal[];
    readonly proposals: readonly ChangeProposal[];
    readonly previous?: GixManifest;
    readonly dryRun: boolean;
    readonly install: boolean;
  },
): void {
  const { project, classification } = data;
  const all = [...data.pending, ...data.proposals];
  const tools = all.flatMap((proposal) => proposal.tools);
  const context = all.flatMap((proposal) => proposal.context);
  const files = all.flatMap((proposal) => proposal.fileChanges);
  const line = (label: string, value: string | number): void => io.out(`  ${label.padEnd(22)}${String(value)}`);
  io.out('');
  io.out(data.dryRun ? 'GIX COPILOT SETUP (dry run: nothing was written or installed)' : 'GIX COPILOT INITIAL SETUP');
  if (data.previous) io.out(`Existing GIX installation detected (${data.previous.sdkVersion}, set up ${data.previous.createdAt}). Nothing is duplicated.`);
  io.out('');
  io.out('PROJECT');
  line('Classification', classification.classification);
  line('Workspace', `${project.workspace.kind} · ${project.workspace.packageManager} · ${project.workspace.language}`);
  for (const summary of classification.summary) io.out(`    ${summary}`);
  if (classification.frontends.length === 0) io.out('    No frontend application detected: no UI or page context is created (§7).');
  io.out('');
  io.out('SERVER');
  line(data.kept.includes(SERVER_FILE) ? 'Kept' : 'Create', `${SERVER_FILE} (dedicated GIX server, Studio at /__gix)`);
  io.out('');
  io.out('UI');
  if (data.selected.length === 0 && classification.frontends.length > 1) io.out('    Several frontends found. Choose with `gix init --apps <path,...>` or in the Studio.');
  for (const app of data.selected) line(app.ui ?? 'app', app.path);
  for (const change of files.filter((file) => file.kind === 'modify')) line('Proposed edit', change.path);
  io.out('');
  io.out('DISCOVERY');
  line('API Sources', project.apis.filter((source) => source.kind !== 'frontend-client').length);
  line('API Operations', project.operations.length);
  line('Routes', project.routes.length);
  line('Pages', project.pages.length);
  io.out('');
  io.out('PROPOSED TOOLS');
  line('Read-only', tools.filter((tool) => tool.risk === 'read-only').length);
  line('Write', tools.filter((tool) => tool.risk === 'write').length);
  line('Destructive', tools.filter((tool) => tool.risk === 'destructive').length);
  line('Needs Review', tools.filter((tool) => tool.confidence === 'review').length);
  io.out('');
  io.out('PROPOSED CONTEXT');
  line('Global', context.filter((item) => !item.page).length);
  line('Page', context.filter((item) => item.page).length);
  io.out('');
  io.out('FILES');
  line('Create now (GIX-owned)', data.created.length);
  line('Proposed create', files.filter((file) => file.kind === 'create').length);
  line('Proposed modify', files.filter((file) => file.kind === 'modify').length);
  line('Delete', files.filter((file) => file.kind === 'delete').length);
  if (!data.install && data.installs.length > 0) {
    io.out('');
    io.out('Install skipped. Run:');
    for (const step of data.installs) io.out(`    (${step.directory}) ${step.command} ${step.args.join(' ')}`);
  }
  io.out('');
  io.out(data.pending.length > 0 && data.proposals.length === 0 ? `${String(data.pending.length)} proposal(s) from an earlier run are still waiting for review.` : `${String(data.proposals.length)} proposal(s) are waiting for review. Nothing in your app changes until you approve.`);
  io.out('Next: npx gix dev   then open http://localhost:4000/__gix');
}
