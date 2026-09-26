import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createDevToolsDemo } from './backend.js';
import { runScenario } from './scenario.js';

/**
 * Generates a realistic multi-agent debug bundle BY EXECUTION (Section 208) - the whole demo
 * scenario runs, then DevTools exports it (sanitized, `redacted` mode). Import the file in the
 * DevTools app. Output: examples/devtools/output/trace-bundle.json (git-ignored).
 */
async function main(): Promise<void> {
  const demo = await createDevToolsDemo();
  await runScenario(demo);
  const bundle = demo.devtools.exportBundle({ mode: 'redacted' });
  const target = resolve(process.argv[2] ?? 'output/trace-bundle.json');
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, JSON.stringify(bundle, null, 2), 'utf8');
  console.log(`Wrote ${bundle.metadata.eventCount} events and ${bundle.metadata.spanCount} spans (${bundle.metadata.runIds.length} runs) to ${target}`);
  await demo.app.close();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
