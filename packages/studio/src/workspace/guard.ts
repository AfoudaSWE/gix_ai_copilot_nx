import { realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, isAbsolute, parse, relative, resolve, sep } from 'node:path';

/** Default secret exclusions (§24). Matched against a file's base name. */
const SECRET_FILE_PATTERNS: readonly RegExp[] = [
  /^\.env$/,
  /^\.env\..+$/,
  /\.pem$/i,
  /\.key$/i,
  /\.p12$/i,
  /\.pfx$/i,
  /^id_rsa(\.pub)?$/,
  /^id_ed25519(\.pub)?$/,
  /^id_ecdsa(\.pub)?$/,
  /^credentials(\..+)?$/i,
  /^secrets(\..+)?$/i,
  /^\.npmrc$/,
  /^\.netrc$/,
];

/** Directories no discovery or apply ever enters (§24, §54). */
export const ALWAYS_IGNORED_DIRECTORIES: ReadonlySet<string> = new Set([
  'node_modules',
  '.git',
  '.hg',
  '.svn',
  '.nx',
  '.ssh',
  '.gnupg',
  '.aws',
  'dist',
  'build',
  'out',
  'web-dist',
  'coverage',
  '.next',
  '.nuxt',
  '.angular',
  '.turbo',
  '.cache',
  '.vite',
  'test-results',
  'playwright-report',
]);

export function isSecretPath(path: string): boolean {
  const name = basename(path);
  return SECRET_FILE_PATTERNS.some((pattern) => pattern.test(name));
}

export class WorkspaceViolationError extends Error {
  readonly path: string;

  constructor(path: string, reason: string) {
    super(`Path "${path}" is not allowed: ${reason}.`);
    this.name = 'WorkspaceViolationError';
    this.path = path;
  }
}

export interface WorkspaceGuard {
  /** The real (symlink-resolved) absolute workspace root. */
  readonly root: string;
  /**
   * Resolves a workspace-relative path to an absolute one, or throws. Blocks `..` escapes,
   * absolute paths, NUL bytes, symlinks that point outside the root, and any path through an
   * always-ignored directory such as `.git` or `.ssh` (§54).
   */
  resolve(path: string): string;
  /** The POSIX-style workspace-relative form of an absolute path inside the root. */
  toRelative(absolute: string): string;
}

function realpathOfNearestExisting(path: string): string {
  let current = path;
  const tail: string[] = [];
  for (;;) {
    try {
      return resolve(realpathSync(current), ...tail.reverse());
    } catch {
      const parent = resolve(current, '..');
      if (parent === current) return path;
      tail.push(basename(current));
      current = parent;
    }
  }
}

function isInside(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

/**
 * Guards one workspace root. The root itself may not be a filesystem root or the user's home
 * directory: a Studio pointed at `~` would put SSH keys and unrelated repositories in scope.
 */
export function createWorkspaceGuard(rootPath: string): WorkspaceGuard {
  const root = realpathSync(resolve(rootPath));
  if (parse(root).root === root) throw new WorkspaceViolationError(root, 'the workspace root cannot be a filesystem root');
  if (root === realpathOfNearestExisting(homedir())) throw new WorkspaceViolationError(root, 'the workspace root cannot be the home directory');

  return {
    root,
    resolve(path) {
      if (typeof path !== 'string' || path.length === 0) throw new WorkspaceViolationError(String(path), 'empty path');
      if (path.includes('\0')) throw new WorkspaceViolationError(path, 'NUL byte');
      if (isAbsolute(path) || /^[a-zA-Z]:/.test(path) || path.startsWith('\\\\')) throw new WorkspaceViolationError(path, 'absolute paths are not accepted');
      if (path.split(/[\\/]/).includes('..')) throw new WorkspaceViolationError(path, 'parent-directory segments are not accepted');
      const absolute = resolve(root, path);
      if (!isInside(root, absolute)) throw new WorkspaceViolationError(path, 'outside the workspace');
      if (!isInside(root, realpathOfNearestExisting(absolute))) throw new WorkspaceViolationError(path, 'resolves outside the workspace through a symbolic link');
      const segments = relative(root, absolute).split(sep);
      if (segments.some((segment) => segment === '.git' || segment === '.ssh' || segment === 'node_modules')) {
        throw new WorkspaceViolationError(path, 'protected directory');
      }
      return absolute;
    },
    toRelative(absolute) {
      return relative(root, absolute).split(sep).join('/');
    },
  };
}
