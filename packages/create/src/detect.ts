import { existsSync, readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

export type Framework = 'react' | 'vue' | 'angular';
export const FRAMEWORKS: readonly Framework[] = ['react', 'vue', 'angular'];
export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun';
export const PACKAGE_MANAGERS: readonly PackageManager[] = ['npm', 'pnpm', 'yarn', 'bun'];

export interface ProjectInfo {
  readonly root: string;
  /** False when there is no package.json yet (a new app will be created). */
  readonly exists: boolean;
  readonly name: string;
  readonly framework?: Framework;
  readonly packageManager: PackageManager;
  readonly typescript: boolean;
  readonly next: boolean;
  /** Relative path of the Vite config, when the app is built with Vite. */
  readonly viteConfig?: string;
  readonly angularJson: boolean;
  readonly srcDir: string;
}

interface PackageJson {
  readonly name?: string;
  readonly dependencies?: Record<string, string>;
  readonly devDependencies?: Record<string, string>;
}

function readPackageJson(root: string): PackageJson | undefined {
  try {
    return JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as PackageJson;
  } catch {
    return undefined;
  }
}

/** Which package manager the project already uses (lockfile first, then the invoking tool). */
export function detectPackageManager(root: string, userAgent: string | undefined): PackageManager {
  if (existsSync(join(root, 'pnpm-lock.yaml'))) return 'pnpm';
  if (existsSync(join(root, 'yarn.lock'))) return 'yarn';
  if (existsSync(join(root, 'bun.lockb')) || existsSync(join(root, 'bun.lock'))) return 'bun';
  if (existsSync(join(root, 'package-lock.json'))) return 'npm';
  const agent = userAgent?.split('/')[0];
  return PACKAGE_MANAGERS.find((manager) => manager === agent) ?? 'npm';
}

export function detectProject(directory: string, userAgent?: string): ProjectInfo {
  const root = resolve(directory);
  const pkg = readPackageJson(root);
  const deps = { ...pkg?.dependencies, ...pkg?.devDependencies };
  const framework: Framework | undefined = deps['@angular/core'] ? 'angular' : deps['vue'] ? 'vue' : deps['react'] ? 'react' : undefined;
  const viteConfig = ['vite.config.ts', 'vite.config.mts', 'vite.config.js', 'vite.config.mjs'].find((file) => existsSync(join(root, file)));
  return {
    root,
    exists: pkg !== undefined,
    name: pkg?.name ?? basename(root),
    framework,
    packageManager: detectPackageManager(root, userAgent),
    typescript: existsSync(join(root, 'tsconfig.json')) || deps['typescript'] !== undefined,
    next: deps['next'] !== undefined,
    viteConfig,
    angularJson: existsSync(join(root, 'angular.json')),
    srcDir: existsSync(join(root, 'src')) || !pkg ? 'src' : '.',
  };
}
