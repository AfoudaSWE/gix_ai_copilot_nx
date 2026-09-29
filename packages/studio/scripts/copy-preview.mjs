// Copies the built live-preview bundle (packages/studio-preview/web-dist) into dist/preview so
// the published package serves the real @gixcopilot/ui preview at /__gix/preview/. Fails the
// build when the bundle is missing: a Studio without its preview must not be packed.
import { cpSync, existsSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const source = fileURLToPath(new URL('../../studio-preview/web-dist/', import.meta.url));
const target = fileURLToPath(new URL('../dist/preview/', import.meta.url));
if (!existsSync(`${source}index.html`)) {
  console.error('studio: the preview bundle is missing; build @gixcopilot/studio-preview first (nx build studio does this).');
  process.exit(1);
}
rmSync(target, { recursive: true, force: true });
cpSync(source, target, { recursive: true });
console.log('studio: copied the live preview bundle to dist/preview');
