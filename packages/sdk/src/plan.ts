import type { ClassifiedApplication, DiscoveredProject, ReadonlyWorkspace } from '@gixcopilot/studio';

export const SDK_VERSION = '0.2.4';

type Manager = DiscoveredProject['workspace']['packageManager'];

export interface InstallStep {
  /** Workspace-relative directory the command runs in ('.' for the root). */
  readonly directory: string;
  readonly packages: readonly string[];
  readonly dev: boolean;
  readonly command: string;
  readonly args: readonly string[];
  readonly reason: string;
}

/** Packages a frontend needs (§10, §11): the framework SDK and, for React, the UI kit. */
export const UI_PACKAGES: Readonly<Record<NonNullable<ClassifiedApplication['ui']>, readonly string[]>> = {
  react: ['@gixcopilot/react', '@gixcopilot/ui'],
  nextjs: ['@gixcopilot/react', '@gixcopilot/ui'],
  angular: ['@gixcopilot/angular', 'zod'],
  vue: ['@gixcopilot/vue'],
};

interface Manifest {
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly devDependencies?: Readonly<Record<string, string>>;
}

async function readManifest(workspace: ReadonlyWorkspace, directory: string): Promise<Manifest | undefined> {
  const text = await workspace.readText(directory === '.' ? 'package.json' : `${directory}/package.json`).catch(() => undefined);
  try {
    return text ? (JSON.parse(text) as Manifest) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * A package spec. `GIX_SDK_TARBALLS` (a JSON map of package name → spec) exists only so the
 * packed-consumer tests can install the tarballs they just built.
 */
function spec(name: string, env: Readonly<Record<string, string | undefined>>): string {
  if (!name.startsWith('@gixcopilot/')) return name;
  const overrides = env['GIX_SDK_TARBALLS'] ? (JSON.parse(env['GIX_SDK_TARBALLS']) as Record<string, string>) : {};
  return overrides[name] ? `${name}@${overrides[name]}` : `${name}@^${SDK_VERSION}`;
}

function command(manager: Manager, packages: readonly string[], dev: boolean, workspaceRoot: boolean): { command: string; args: string[] } {
  switch (manager) {
    case 'npm':
      return { command: 'npm', args: ['install', ...(dev ? ['--save-dev'] : []), ...packages] };
    case 'pnpm':
      return { command: 'pnpm', args: ['add', ...(dev ? ['-D'] : []), ...(workspaceRoot ? ['-w'] : []), ...packages] };
    case 'yarn':
      return { command: 'yarn', args: ['add', ...(dev ? ['-D'] : []), ...packages] };
    case 'bun':
      return { command: 'bun', args: ['add', ...(dev ? ['-d'] : []), ...packages] };
  }
}

/**
 * What to install, where (§10). Only what each selected app needs, in the app that imports it,
 * and never a package the manifest already lists. Generated modules import their own
 * dependencies directly; SDK transitive dependencies are not sufficient with pnpm.
 */
export async function planInstalls(input: {
  readonly workspace: ReadonlyWorkspace;
  readonly project: DiscoveredProject;
  readonly apps: readonly ClassifiedApplication[];
  readonly env: Readonly<Record<string, string | undefined>>;
}): Promise<InstallStep[]> {
  const { project } = input;
  const manager = project.workspace.packageManager;
  const workspaceRoot = project.workspace.kind !== 'single';
  const steps: InstallStep[] = [];
  const has = (manifest: Manifest | undefined, name: string): boolean => manifest?.dependencies?.[name] !== undefined || manifest?.devDependencies?.[name] !== undefined;
  const root = await readManifest(input.workspace, '.');
  const rootNeeds = ['@gixcopilot/sdk', '@gixcopilot/openapi', '@gixcopilot/tools', '@gixcopilot/protocol', '@gixcopilot/security', 'zod'].filter((name) => !has(root, name));
  if (rootNeeds.length > 0) steps.push({ directory: '.', packages: rootNeeds, dev: false, ...command(manager, rootNeeds.map((name) => spec(name, input.env)), false, workspaceRoot), reason: 'the GIX server, Studio and generated tools/policies' });
  if (!has(root, 'typescript')) steps.push({ directory: '.', packages: ['typescript'], dev: true, ...command(manager, ['typescript'], true, workspaceRoot), reason: 'source analysis for discovery' });
  const byDirectory = new Map<string, Set<string>>();
  for (const app of input.apps) {
    if (!app.ui) continue;
    // Apps that share the root manifest (typical in Nx) get their packages at the root.
    const own = app.path !== '.' && (await readManifest(input.workspace, app.path)) !== undefined;
    const directory = own ? app.path : '.';
    const manifest = own ? await readManifest(input.workspace, app.path) : root;
    const set = byDirectory.get(directory) ?? new Set<string>();
    for (const name of UI_PACKAGES[app.ui]) if (!has(manifest, name) && !(directory === '.' && rootNeeds.includes(name))) set.add(name);
    byDirectory.set(directory, set);
  }
  for (const [directory, set] of byDirectory) {
    if (set.size === 0) continue;
    const packages = [...set].sort();
    steps.push({ directory, packages, dev: false, ...command(manager, packages.map((name) => spec(name, input.env)), false, workspaceRoot && directory === '.'), reason: 'the copilot UI' });
  }
  return steps;
}
