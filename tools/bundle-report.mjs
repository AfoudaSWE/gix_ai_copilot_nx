#!/usr/bin/env node
// Client bundle measurement (Phase 12 Section 147-148). Builds minified ESM bundles of the
// browser entry points with the workspace's Vite (React/react-dom external, like an app), and:
//   - reports raw and gzip size per scenario,
//   - FAILS if any browser bundle contains a server module (openai, pg, ioredis, bullmq,
//     fastify, drizzle, node: built-ins),
//   - checks tree shaking: importing one small export must stay small.
// Run after `pnpm build`.   node tools/bundle-report.mjs [--check] [--json]

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';

const root = resolve(import.meta.dirname, '..');
const check = process.argv.includes('--check');
const asJson = process.argv.includes('--json');
const requireFromApp = createRequire(join(root, 'apps', 'platform', 'package.json'));
const { build } = await import(pathToFileURL(requireFromApp.resolve('vite')).href);

// Budgets are regression guards set from measured values (gzip, bytes), not targets.
const SCENARIOS = [
  { name: 'protocol: PROTOCOL_VERSION only (tree shaking)', code: "import { PROTOCOL_VERSION } from '@gixcopilot/protocol'; console.log(PROTOCOL_VERSION);", budget: 1_000 },
  { name: 'client: createCopilotClient', code: "import { createCopilotClient } from '@gixcopilot/client'; console.log(createCopilotClient);", budget: 41_000 },
  { name: 'headless: createChatStore + parts', code: "import { createChatStore, createCopilotParts } from '@gixcopilot/headless'; console.log(createChatStore, createCopilotParts);", budget: 13_000 },
  { name: 'react: CopilotProvider + useCopilotChat', code: "import { CopilotProvider, useCopilotChat } from '@gixcopilot/react'; console.log(CopilotProvider, useCopilotChat);", budget: 52_000 },
  { name: 'ui: CopilotChat (full styled chat)', code: "import { CopilotChat } from '@gixcopilot/ui'; console.log(CopilotChat);", budget: 72_000 },
];
const SERVER = [/node_modules\/openai\//, /node_modules\/pg\//, /node_modules\/ioredis\//, /node_modules\/bullmq\//, /node_modules\/fastify\//, /node_modules\/drizzle-orm\//, /^node:/, /packages\/(server|persistence-postgres|redis|jobs|management|node|config)\//];

const work = join(root, 'tools', '.bundle-entries');
rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });
const results = [];
try {
  for (const [index, scenario] of SCENARIOS.entries()) {
    const entry = join(work, `entry-${index}.js`);
    writeFileSync(entry, `${scenario.code}\n`);
    const output = await build({
      root: work,
      logLevel: 'silent',
      configFile: false,
      resolve: {
        conditions: ['browser', 'import', 'default'],
        // Measured packages resolve to their built output; their own dependencies resolve from
        // each package's node_modules, exactly as in an application.
        alias: Object.fromEntries(['protocol', 'client', 'headless', 'react', 'ui'].map((name) => [`@gixcopilot/${name}`, join(root, 'packages', name, 'dist', 'index.js')])),
      },
      build: {
        write: false,
        minify: true,
        target: 'es2022',
        lib: { entry, formats: ['es'], fileName: `bundle-${index}` },
        rollupOptions: { external: [/^react($|\/)/, /^react-dom($|\/)/] },
      },
    });
    const chunks = (Array.isArray(output) ? output : [output]).flatMap((result) => result.output).filter((item) => item.type === 'chunk');
    const code = chunks.map((chunk) => chunk.code).join('\n');
    const modules = chunks.flatMap((chunk) => Object.keys(chunk.modules ?? {})).map((id) => id.replaceAll('\\', '/'));
    const leaks = modules.filter((id) => SERVER.some((pattern) => pattern.test(id)));
    const gzip = gzipSync(code).length;
    results.push({ scenario: scenario.name, rawBytes: Buffer.byteLength(code), gzipBytes: gzip, budgetGzip: scenario.budget, overBudget: gzip > scenario.budget, serverModules: leaks, zod: modules.some((id) => id.includes('node_modules/zod/')) });
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}

if (asJson) console.log(JSON.stringify(results, null, 2));
else {
  for (const result of results) {
    const status = result.serverModules.length > 0 || (check && result.overBudget) ? 'FAIL' : 'ok  ';
    console.log(`${status} ${result.scenario.padEnd(48)} ${(result.rawBytes / 1024).toFixed(1).padStart(7)} kB raw ${(result.gzipBytes / 1024).toFixed(1).padStart(6)} kB gzip${result.zod ? '  (includes zod)' : ''}`);
    for (const leak of result.serverModules) console.log(`       server module in browser bundle: ${leak}`);
  }
}
const failed = results.some((result) => result.serverModules.length > 0 || (check && result.overBudget));
process.exit(failed ? 1 : 0);
