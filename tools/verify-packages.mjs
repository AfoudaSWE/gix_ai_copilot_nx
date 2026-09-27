#!/usr/bin/env node
// Packs every publishable workspace package with `pnpm pack` (which rewrites `workspace:*`
// specifiers exactly as a publish would) and inspects the real tarball contents
// (Phase 12 Sections 124 and 193). Run after `pnpm build`.
//
//   node tools/verify-packages.mjs [--out <dir>] [--keep] [--json]
//
// Fails (exit 1) when a tarball contains test files, build caches, env files or anything that
// looks like a secret, when an `exports` / `types` / `bin` target is missing from the tarball,
// when a README, LICENSE file or `license` field is missing, or when the packed manifest still has `workspace:` specifiers.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

const root = resolve(import.meta.dirname, '..');
const { values } = parseArgs({
  options: { out: { type: 'string' }, keep: { type: 'boolean' }, json: { type: 'boolean' } },
});

const FORBIDDEN_FILES = [
  [/(^|\/)\.env(\.|$)/, 'environment file'],
  [/\.spec\.[cm]?[jt]sx?(\.map)?$|\.spec\.d\.ts(\.map)?$/, 'test file'],
  [/\.spec-helper\./, 'test helper'],
  [/\.tsbuildinfo$/, 'build cache'],
  [/(^|\/)node_modules\//, 'node_modules'],
  [/\.(pem|key|p12|pfx)$/, 'private key material'],
  [/(^|\/)src\/.*\.tsx?$/, 'TypeScript source'],
];

const SECRET_PATTERNS = [
  [/sk-(proj-)?[A-Za-z0-9_-]{32,}/, 'OpenAI-style API key'],
  [/sk-ant-[A-Za-z0-9_-]{20,}/, 'Anthropic-style API key'],
  [/AKIA[0-9A-Z]{16}/, 'AWS access key id'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'PEM private key'],
  [/gh[pousr]_[A-Za-z0-9]{36,}/, 'GitHub token'],
  [/xox[baprs]-[A-Za-z0-9-]{10,}/, 'Slack token'],
  [/(postgres(ql)?|redis):\/\/[^:\s/'"]+:[^@\s'"]{3,}@(?!localhost|127\.0\.0\.1|postgres|redis|host|example)/, 'connection string with credentials'],
];

function publishableDirs() {
  const dirs = [];
  const visit = (dir, depth) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (name === 'node_modules' || name === 'dist' || !statSync(full).isDirectory()) continue;
      const manifest = join(full, 'package.json');
      if (existsSync(manifest)) {
        const pkg = JSON.parse(readFileSync(manifest, 'utf8'));
        if (!pkg.private) dirs.push(full);
      } else if (depth > 0) {
        visit(full, depth - 1);
      }
    }
  };
  visit(join(root, 'packages'), 1);
  return dirs.sort();
}

/** Minimal ustar/pax reader: npm tarballs only hold regular files under `package/`. */
function readTarball(path) {
  const data = gunzipSync(readFileSync(path));
  const entries = new Map();
  let offset = 0;
  let paxPath;
  const text = (start, length) => {
    const raw = data.subarray(start, start + length).toString('utf8');
    const end = raw.indexOf('\0');
    return end === -1 ? raw : raw.slice(0, end);
  };
  while (offset + 512 <= data.length) {
    const header = data.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const size = parseInt(text(offset + 124, 12).trim() || '0', 8);
    const type = header[156] === 0 ? '0' : String.fromCharCode(header[156]);
    const prefix = text(offset + 345, 155);
    const name = prefix ? `${prefix}/${text(offset, 100)}` : text(offset, 100);
    const body = data.subarray(offset + 512, offset + 512 + size);
    if (type === 'x') {
      paxPath = /\d+ path=([^\n]*)\n/.exec(body.toString('utf8'))?.[1];
    } else {
      if (type === '0') entries.set((paxPath ?? name).replace(/^package\//, ''), body);
      paxPath = undefined;
    }
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return entries;
}

/** Every file path an `exports` / `types` / `main` / `bin` entry points at. */
function declaredTargets(pkg) {
  const targets = new Set();
  const collect = (value) => {
    if (typeof value === 'string') {
      if (!value.includes('*')) targets.add(value.replace(/^\.\//, ''));
    } else if (value && typeof value === 'object') {
      for (const nested of Object.values(value)) collect(nested);
    }
  };
  collect(pkg.exports);
  collect(pkg.main);
  collect(pkg.types);
  collect(pkg.module);
  collect(pkg.bin);
  targets.delete('package.json');
  return [...targets];
}

const outDir = values.out ? resolve(values.out) : mkdtempSync(join(tmpdir(), 'gix-pack-'));
mkdirSync(outDir, { recursive: true });
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const results = [];

for (const dir of publishableDirs()) {
  const source = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  const problems = [];
  const output = execFileSync(pnpm, ['pack', '--pack-destination', outDir], {
    cwd: dir,
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  const tarball = output.trim().split(/\r?\n/).filter((line) => line.endsWith('.tgz')).pop();
  if (!tarball) throw new Error(`pnpm pack produced no tarball for ${source.name}:\n${output}`);
  const tarPath = resolve(outDir, tarball.split(/[\\/]/).pop());

  const entries = readTarball(tarPath);
  const files = [...entries.keys()];
  const packed = JSON.parse(entries.get('package.json').toString('utf8'));

  for (const file of files) {
    for (const [pattern, label] of FORBIDDEN_FILES) {
      if (pattern.test(file)) problems.push(`${label}: ${file}`);
    }
    if (/\.(js|mjs|cjs|d\.ts|json|md|css|map|txt)$/.test(file)) {
      const text = entries.get(file).toString('utf8');
      for (const [pattern, label] of SECRET_PATTERNS) {
        if (pattern.test(text)) problems.push(`possible ${label} in ${file}`);
      }
    }
  }
  for (const target of declaredTargets(packed)) {
    if (!files.includes(target)) problems.push(`declared entry point missing from tarball: ${target}`);
  }
  if (!files.some((file) => /^readme\.md$/i.test(file))) problems.push('README.md missing');
  if (!files.some((file) => /^licen[sc]e(\.md|\.txt)?$/i.test(file))) problems.push('LICENSE file missing');
  if (!packed.license) problems.push('license field missing');
  if (!packed.types && !packed.exports?.['.']?.types) problems.push('no type declarations declared');
  const specifiers = { ...packed.dependencies, ...packed.peerDependencies, ...packed.optionalDependencies };
  for (const [name, range] of Object.entries(specifiers)) {
    if (String(range).startsWith('workspace:')) problems.push(`unresolved workspace specifier: ${name}@${range}`);
  }
  if (packed.private) problems.push('manifest is private');

  const size = statSync(tarPath).size;
  results.push({
    name: source.name,
    version: packed.version,
    tarball: tarPath,
    files: files.length,
    packedKb: Math.round(size / 102.4) / 10,
    license: packed.license ?? null,
    problems,
  });
}

const failed = results.filter((result) => result.problems.length > 0);
if (values.json) {
  console.log(JSON.stringify({ outDir, packages: results }, null, 2));
} else {
  for (const result of results) {
    const status = result.problems.length === 0 ? 'ok  ' : 'FAIL';
    console.log(`${status} ${result.name.padEnd(36)} ${String(result.files).padStart(4)} files ${String(result.packedKb).padStart(8)} kB`);
    for (const problem of result.problems) console.log(`       - ${problem}`);
  }
  console.log(`\n${results.length} packages packed to ${outDir}; ${failed.length} failed.`);
}
if (!values.keep && !values.out) rmSync(outDir, { recursive: true, force: true });
process.exit(failed.length > 0 ? 1 : 0);
