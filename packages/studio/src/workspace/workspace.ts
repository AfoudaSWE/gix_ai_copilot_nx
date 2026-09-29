import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { lstat, readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { ALWAYS_IGNORED_DIRECTORIES, createWorkspaceGuard, isSecretPath, WorkspaceViolationError } from './guard.js';
import type { WorkspaceGuard } from './guard.js';

export interface WorkspaceLimits {
  /** Largest file read or analyzed, in bytes (default 512 KiB). */
  readonly maxFileBytes: number;
  /** Most files one walk returns (default 20 000). */
  readonly maxFiles: number;
}

export const DEFAULT_WORKSPACE_LIMITS: WorkspaceLimits = { maxFileBytes: 512 * 1024, maxFiles: 20_000 };

export interface WorkspaceFile {
  /** POSIX-style path relative to the workspace root. */
  readonly path: string;
  readonly size: number;
}

export interface ListFilesOptions {
  /** Keep only files whose extension (with dot, lower case) is listed. */
  readonly extensions?: readonly string[];
  readonly signal?: AbortSignal;
}

export interface ListFilesResult {
  readonly files: readonly WorkspaceFile[];
  /** True when `maxFiles` stopped the walk early. */
  readonly truncated: boolean;
  readonly skippedSecrets: number;
}

/**
 * The only filesystem view discovery and generators get (§12, §66). It has no write method,
 * so read-only is a property of the type, not a convention: code holding a
 * `ReadonlyWorkspace` cannot modify the repository.
 */
export interface ReadonlyWorkspace {
  readonly root: string;
  readonly limits: WorkspaceLimits;
  readonly guard: WorkspaceGuard;
  listFiles(options?: ListFilesOptions): Promise<ListFilesResult>;
  exists(path: string): Promise<boolean>;
  /** UTF-8 text of a non-secret file inside the workspace, or `undefined` when missing or too large. */
  readText(path: string): Promise<string | undefined>;
  /** SHA-256 of the file's bytes, or `null` when it does not exist. */
  hash(path: string): Promise<string | null>;
}

export class SecretFileError extends WorkspaceViolationError {
  constructor(path: string) {
    super(path, 'secret files are never read');
    this.name = 'SecretFileError';
  }
}

export function sha256(content: string | Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

function globToRegExp(glob: string): RegExp {
  let pattern = '';
  for (let index = 0; index < glob.length; index += 1) {
    const char = glob[index] ?? '';
    if (char === '*') {
      if (glob[index + 1] === '*') {
        pattern += '.*';
        index += 1;
        if (glob[index + 1] === '/') index += 1;
      } else pattern += '[^/]*';
    } else if (char === '?') pattern += '[^/]';
    else pattern += /[.+^${}()|[\]\\]/.test(char) ? `\\${char}` : char;
  }
  return new RegExp(`^${pattern}$`);
}

/**
 * A deliberately small `.gitignore` reader (§24 "respect ignore rules"): plain names, `*`,
 * `**`, `?`, a leading `/` anchor and a trailing `/` directory marker. Negations (`!`) are
 * not supported and are skipped; the always-ignored directories cover the usual cases.
 */
export function parseIgnoreFile(text: string): (path: string, isDirectory: boolean) => boolean {
  const rules = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#') && !line.startsWith('!'))
    .map((line) => {
      const directoryOnly = line.endsWith('/');
      const body = line.replace(/\/+$/, '');
      const anchored = body.startsWith('/') || body.includes('/');
      return { directoryOnly, anchored, regex: globToRegExp(body.replace(/^\//, '')) };
    });
  return (path, isDirectory) =>
    rules.some((rule) => {
      if (rule.directoryOnly && !isDirectory) return false;
      if (rule.anchored) return rule.regex.test(path);
      return path.split('/').some((segment) => rule.regex.test(segment));
    });
}

export function createReadonlyWorkspace(rootPath: string, limits: Partial<WorkspaceLimits> = {}): ReadonlyWorkspace {
  const guard = createWorkspaceGuard(rootPath);
  const resolvedLimits: WorkspaceLimits = { ...DEFAULT_WORKSPACE_LIMITS, ...limits };
  let ignored: ((path: string, isDirectory: boolean) => boolean) | undefined;
  const isIgnored = (path: string, isDirectory: boolean): boolean => {
    if (!ignored) {
      try {
        ignored = parseIgnoreFile(readFileSync(join(guard.root, '.gitignore'), 'utf8'));
      } catch {
        ignored = () => false;
      }
    }
    return ignored(path, isDirectory);
  };

  const readChecked = (path: string): string => {
    const absolute = guard.resolve(path);
    if (isSecretPath(absolute)) throw new SecretFileError(path);
    return absolute;
  };

  return {
    root: guard.root,
    limits: resolvedLimits,
    guard,
    async listFiles(options = {}) {
      const files: WorkspaceFile[] = [];
      let truncated = false;
      let skippedSecrets = 0;
      const extensions = options.extensions?.map((extension) => extension.toLowerCase());
      const walk = async (directory: string, relativeDirectory: string): Promise<void> => {
        options.signal?.throwIfAborted();
        let entries;
        try {
          entries = await readdir(directory, { withFileTypes: true });
        } catch {
          return;
        }
        entries.sort((a, b) => a.name.localeCompare(b.name));
        for (const entry of entries) {
          if (truncated) return;
          const relativePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
          // Symbolic links are never followed: they could leave the workspace.
          if (entry.isSymbolicLink()) continue;
          if (entry.isDirectory()) {
            if (ALWAYS_IGNORED_DIRECTORIES.has(entry.name) || isIgnored(relativePath, true)) continue;
            await walk(join(directory, entry.name), relativePath);
            continue;
          }
          if (!entry.isFile() || isIgnored(relativePath, false)) continue;
          if (isSecretPath(entry.name)) {
            skippedSecrets += 1;
            continue;
          }
          const lower = entry.name.toLowerCase();
          if (extensions && !extensions.some((extension) => lower.endsWith(extension))) continue;
          if (files.length >= resolvedLimits.maxFiles) {
            truncated = true;
            return;
          }
          const info = await stat(join(directory, entry.name)).catch(() => undefined);
          files.push({ path: relativePath, size: info?.size ?? 0 });
        }
      };
      await walk(guard.root, '');
      return { files, truncated, skippedSecrets };
    },
    async exists(path) {
      try {
        await lstat(guard.resolve(path));
        return true;
      } catch (error) {
        if (error instanceof WorkspaceViolationError) throw error;
        return false;
      }
    },
    async readText(path) {
      const absolute = readChecked(path);
      const info = await stat(absolute).catch(() => undefined);
      if (!info?.isFile() || info.size > resolvedLimits.maxFileBytes) return undefined;
      return readFile(absolute, 'utf8');
    },
    async hash(path) {
      const absolute = readChecked(path);
      try {
        return sha256(await readFile(absolute));
      } catch {
        return null;
      }
    },
  };
}
