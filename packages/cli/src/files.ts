import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';

export interface PlannedFile {
  /** Path relative to the project root. */
  readonly path: string;
  readonly content: string;
}

export interface WriteResult {
  readonly written: readonly string[];
  readonly conflicts: readonly string[];
}

/**
 * Writes generated files without ever overwriting silently (Section 28, 38): existing files are
 * reported as conflicts and NOTHING is written unless `force` is set. Paths can never escape
 * the project root.
 */
export async function writePlan(root: string, files: readonly PlannedFile[], options: { readonly force?: boolean; readonly dryRun?: boolean } = {}): Promise<WriteResult> {
  const base = resolve(root);
  const targets = files.map((file) => {
    const target = resolve(base, file.path);
    if (target !== base && !target.startsWith(base + sep)) throw new Error(`Refusing to write outside the project: ${file.path}`);
    return { ...file, target };
  });
  const conflicts = targets.filter((file) => existsSync(file.target)).map((file) => relative(base, file.target).replaceAll('\\', '/'));
  if (conflicts.length > 0 && !options.force) return { written: [], conflicts };
  if (options.dryRun) return { written: targets.map((file) => file.path), conflicts };
  for (const file of targets) {
    await mkdir(dirname(file.target), { recursive: true });
    await writeFile(file.target, file.content, 'utf8');
  }
  return { written: targets.map((file) => file.path), conflicts };
}

export async function readJson<T>(path: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T;
  } catch {
    return undefined;
  }
}

export function projectFile(root: string, ...segments: string[]): string {
  return join(resolve(root), ...segments);
}

/** Appends an export line to an index file once (idempotent), creating the file if needed. */
export async function appendExport(indexPath: string, line: string): Promise<boolean> {
  const current = existsSync(indexPath) ? await readFile(indexPath, 'utf8') : '';
  if (current.includes(line)) return false;
  await mkdir(dirname(indexPath), { recursive: true });
  await writeFile(indexPath, `${current}${current && !current.endsWith('\n') ? '\n' : ''}${line}\n`, 'utf8');
  return true;
}
