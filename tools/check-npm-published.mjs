#!/usr/bin/env node
// Compares every publishable workspace package with what the npm registry actually serves,
// so a partial publish (some packages published, the rest failed or skipped) turns a release
// red instead of leaving npm in a mixed state. See docs/RELEASING.md.
//
//   node tools/check-npm-published.mjs [--expect <version>] [--tag <dist-tag>] [--json]
//
// Without --expect, each package's local package.json version is expected. Fails (exit 1)
// when any package is missing from npm (404) or its dist-tag (default `latest`) does not
// point at the expected version. Registry/network errors also fail, never pass silently.

import { execFile } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { promisify } from 'node:util';

const run = promisify(execFile);
const root = resolve(import.meta.dirname, '..');
const { values } = parseArgs({
  options: {
    expect: { type: 'string' },
    tag: { type: 'string', default: 'latest' },
    json: { type: 'boolean' },
  },
});

function publishablePackages() {
  const packages = [];
  const visit = (dir, depth) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (name === 'node_modules' || name === 'dist' || !statSync(full).isDirectory()) continue;
      const manifest = join(full, 'package.json');
      if (existsSync(manifest)) {
        const pkg = JSON.parse(readFileSync(manifest, 'utf8'));
        if (!pkg.private) packages.push({ name: pkg.name, local: pkg.version });
      } else if (depth > 0) {
        visit(full, depth - 1);
      }
    }
  };
  visit(join(root, 'packages'), 1);
  return packages.sort((a, b) => a.name.localeCompare(b.name));
}

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

async function registryVersion(name, tag) {
  try {
    const { stdout } = await run(npm, ['view', name, `dist-tags.${tag}`], {
      shell: process.platform === 'win32',
      encoding: 'utf8',
    });
    return { version: stdout.trim() || null, error: null };
  } catch (error) {
    const text = `${error.stdout ?? ''}${error.stderr ?? ''}`;
    if (/E404|404 Not Found/.test(text)) return { version: null, error: null };
    return { version: null, error: text.split(/\r?\n/).find((line) => line.trim()) ?? String(error) };
  }
}

const packages = publishablePackages();
const results = [];
// Small batches: fast, without tripping registry rate limits.
for (let index = 0; index < packages.length; index += 8) {
  const batch = packages.slice(index, index + 8);
  results.push(
    ...(await Promise.all(
      batch.map(async (pkg) => {
        const expected = values.expect ?? pkg.local;
        const { version, error } = await registryVersion(pkg.name, values.tag);
        const status = error ? 'error' : version === null ? 'missing' : version === expected ? 'ok' : 'stale';
        return { ...pkg, expected, registry: version, status, error };
      }),
    )),
  );
}

const failed = results.filter((result) => result.status !== 'ok');
if (values.json) {
  console.log(JSON.stringify({ tag: values.tag, packages: results }, null, 2));
} else {
  for (const result of results) {
    const label = { ok: 'ok     ', stale: 'STALE  ', missing: 'MISSING', error: 'ERROR  ' }[result.status];
    const registry = result.registry ?? (result.status === 'error' ? result.error : 'not published');
    console.log(`${label} ${result.name.padEnd(36)} expected ${result.expected.padEnd(10)} npm(${values.tag}) ${registry}`);
  }
  console.log(`\n${results.length} packages checked; ${results.length - failed.length} ok, ${failed.length} not.`);
}
process.exit(failed.length > 0 ? 1 : 0);
