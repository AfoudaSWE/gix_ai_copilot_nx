#!/usr/bin/env node
// Generates docs/reference/api.md and docs/reference/api.json from each publishable package's
// shipped type declarations (dist/index.d.ts, or ng-packagr's types/*.d.ts), so the reference
// lists exactly what a consumer can import. api.json adds each export's kind and declared
// signature for the documentation portal. Run after `pnpm build`:
//   node tools/api-reference.mjs [--check]

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const check = process.argv.includes('--check');

function packageDirs() {
  const out = [];
  for (const base of ['packages', 'packages/providers', 'packages/vectorstores']) {
    for (const name of readdirSync(join(root, base))) {
      const dir = join(root, base, name);
      if (statSync(dir).isDirectory() && existsSync(join(dir, 'package.json'))) out.push(dir);
    }
  }
  return out;
}

function exportsOf(dts, bundled) {
  const values = new Set();
  const types = new Set();
  const text = dts.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const declaredValue = (name) => new RegExp(`declare\\s+(?:const|function|class|let|enum|abstract class)\\s+${name}\\b`).test(text);
  const declaredType = (name) => new RegExp(`(?:interface|type)\\s+${name}\\b`).test(text);
  for (const match of text.matchAll(/export\s+(type\s+)?\{([^}]*)\}(\s*from)?/g)) {
    for (const raw of (match[2] ?? '').split(',')) {
      const part = raw.trim();
      if (!part) continue;
      const local = part.replace(/^type\s+/, '').split(/\s+as\s+/)[0].trim();
      // Bundled declarations (ng-packagr) export local or imported names without "from":
      // classify by declaration kind; imported PascalCase names are types.
      const inferredType = (bundled || !match[3]) && !declaredValue(local) && (declaredType(local) || /^[A-Z][a-z]/.test(local));
      const isType = Boolean(match[1]) || part.startsWith('type ') || inferredType;
      const name = part.replace(/^type\s+/, '').split(/\s+as\s+/).pop().trim();
      if (name && name !== 'default') (isType ? types : values).add(name);
    }
  }
  for (const match of text.matchAll(/export\s+declare\s+(?:const|function|class|let|enum|abstract class)\s+([A-Za-z_$][\w$]*)/g)) values.add(match[1]);
  for (const match of text.matchAll(/export\s+(?:declare\s+)?(?:interface|type)\s+([A-Za-z_$][\w$]*)/g)) types.add(match[1]);
  for (const match of text.matchAll(/export\s+\*\s+as\s+([A-Za-z_$][\w$]*)/g)) values.add(`${match[1]} (namespace)`);
  for (const name of values) types.delete(name);
  return { values: [...values].sort(), types: [...types].sort() };
}

/** Every .d.ts the package ships (excluding tests), so re-exported declarations are found. */
function declarationFiles(dir) {
  const out = [];
  const visit = (current) => {
    if (!existsSync(current)) return;
    for (const name of readdirSync(current)) {
      const full = join(current, name);
      if (statSync(full).isDirectory()) visit(full);
      else if (name.endsWith('.d.ts') && !/\.spec(-helper)?\.d\.ts$/.test(name)) out.push(full);
    }
  };
  visit(join(dir, 'dist'));
  return out.sort();
}

/** The declared signature of one export: its kind plus declaration text (bodies elided). */
function declarationOf(name, text) {
  const id = name.replace(/\$/g, '\\$');
  const patterns = [
    ['function', new RegExp(`(?:export\\s+)?declare\\s+function\\s+${id}\\b[\\s\\S]*?\\)(?:\\s*:\\s*[^;\\n]+)?;`)],
    ['class', new RegExp(`(?:export\\s+)?declare\\s+(?:abstract\\s+)?class\\s+${id}\\b[^{]*`)],
    ['const', new RegExp(`(?:export\\s+)?declare\\s+(?:const|let)\\s+${id}\\b[\\s\\S]*?;(?=\\s*\\n|$)`)],
    ['enum', new RegExp(`(?:export\\s+)?declare\\s+enum\\s+${id}\\b[^{]*`)],
    ['interface', new RegExp(`(?:export\\s+)?interface\\s+${id}\\b[^{]*`)],
    ['type', new RegExp(`(?:export\\s+)?(?:declare\\s+)?type\\s+${id}\\b[\\s\\S]*?;(?=\\s*\\n|$)`)],
  ];
  for (const [kind, pattern] of patterns) {
    const match = pattern.exec(text);
    if (!match) continue;
    let signature = match[0].replace(/^export\s+/, '').replace(/^declare\s+/, '').trim();
    if (kind === 'class' || kind === 'interface' || kind === 'enum') {
      // Keep the members: walk to the brace that closes the declaration body.
      const open = text.indexOf('{', match.index + match[0].length - 1);
      let depth = 0;
      let end = open;
      for (; end < text.length && open !== -1; end += 1) {
        if (text[end] === '{') depth += 1;
        else if (text[end] === '}' && --depth === 0) break;
      }
      const body = open === -1 ? '{ … }' : text.slice(open, end + 1).replace(/\n\s*\n/g, '\n');
      signature = `${signature} ${body.length > 1400 ? `${body.slice(0, 1400)}\n  …\n}` : body}`;
    }
    if (signature.length > 1600) signature = `${signature.slice(0, 1600)} …`;
    return { kind, signature };
  }
  return { kind: undefined, signature: undefined };
}

/** Maturity labels from the README capability table (Beta unless listed). */
const STATUS = { management: 'experimental' };

const sections = [];
const json = [];
for (const dir of packageDirs()) {
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  if (pkg.private) continue;
  const bundled = existsSync(join(dir, 'dist', 'types'));
  const candidates = [join(dir, 'dist', 'index.d.ts'), ...(bundled ? readdirSync(join(dir, 'dist', 'types')).map((file) => join(dir, 'dist', 'types', file)) : [])];
  const dts = candidates.filter(existsSync).map((file) => readFileSync(file, 'utf8')).join('\n');
  if (!dts) throw new Error(`${pkg.name}: no built declarations; run pnpm build first`);
  const { values, types } = exportsOf(dts, bundled);
  const subpaths = Object.keys(pkg.exports ?? {}).filter((key) => key !== '.' && key !== './package.json');
  const declarations = declarationFiles(dir)
    .map((file) => readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, ''))
    .join('\n');
  const describe = (name) => ({ name, ...declarationOf(name.replace(/ \(namespace\)$/, ''), declarations) });
  const slug = pkg.name.split('/')[1];
  json.push({
    name: pkg.name,
    slug,
    description: pkg.description ?? '',
    status: STATUS[slug] ?? 'beta',
    directory: pkg.repository?.directory ?? '',
    subpaths: subpaths.map((path) => `${pkg.name}${path.slice(1)}`),
    peerDependencies: Object.keys(pkg.peerDependencies ?? {}),
    values: values.map(describe),
    types: types.map(describe),
  });
  sections.push(
    `## ${pkg.name}\n\n${pkg.description ?? ''}\n\n` +
      `**Values (${values.length}):** ${values.map((name) => `\`${name}\``).join(', ') || '—'}\n\n` +
      `**Types (${types.length}):** ${types.map((name) => `\`${name}\``).join(', ') || '—'}\n` +
      (subpaths.length > 0 ? `\n**Subpath exports:** ${subpaths.map((path) => `\`${pkg.name}${path.slice(1)}\``).join(', ')}\n` : ''),
  );
}

const content = `# API reference

Generated by \`tools/api-reference.mjs\` from the type declarations each package ships (the
exact public surface a consumer can import; anything not listed is internal). Every package
is ESM-only, ships \`.d.ts\` + source maps, targets Node >= 22.12 and modern browsers, and is
side-effect free unless noted (\`@gixcopilot/ui\` CSS). Usage and semantics: the guides and
each package's README.

${sections.join('\n')}`;

const target = join(root, 'docs', 'reference', 'api.md');
const jsonTarget = join(root, 'docs', 'reference', 'api.json');
const jsonContent = `${JSON.stringify({ generatedBy: 'tools/api-reference.mjs', packages: json }, null, 2)}\n`;
const normalize = (text) => text.replace(/\r\n/g, '\n');
if (check) {
  const stale = [
    [target, content],
    [jsonTarget, jsonContent],
  ].filter(([file, expected]) => normalize(existsSync(file) ? readFileSync(file, 'utf8') : '') !== expected);
  if (stale.length > 0) {
    console.error(`${stale.map(([file]) => file.slice(root.length + 1)).join(', ')} out of date; run node tools/api-reference.mjs`);
    process.exit(1);
  }
  console.log('API reference is up to date.');
} else {
  writeFileSync(target, content);
  writeFileSync(jsonTarget, jsonContent);
  console.log(`Wrote docs/reference/api.md and docs/reference/api.json (${sections.length} packages).`);
}
