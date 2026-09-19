import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';

// Reuse the examples' Vite installation; do not add a second bundler.
const require = createRequire(new URL('../examples/react-basic/package.json', import.meta.url));
const { build } = await import(pathToFileURL(require.resolve('vite')).href);
for (const name of ['react', 'ui']) {
  const result = await build({
    configFile: false,
    logLevel: 'silent',
    build: {
      write: false,
      minify: true,
      lib: {
        entry: fileURLToPath(new URL(`../packages/${name}/dist/index.js`, import.meta.url)),
        formats: ['es'],
        fileName: name,
      },
      rollupOptions: {
        external: (id) =>
          id === 'react' || id.startsWith('react/') || id.startsWith('@gixcopilot/'),
      },
    },
  });
  const outputs = (Array.isArray(result) ? result : [result]).flatMap((bundle) => bundle.output);
  const code = outputs
    .filter((output) => output.type === 'chunk')
    .map((output) => output.code)
    .join('\n');
  console.log(
    `${name}: ${Buffer.byteLength(code)} bytes minified, ${gzipSync(code).byteLength} bytes gzip (React and workspace dependencies external)`,
  );
}
