import { defineConfig } from 'vite';

/** `/devtools` is proxied to the host app (e.g. examples/devtools on :4100) during development,
 * so the UI talks to the DevTools API same-origin and no CORS opening is needed. */
export default defineConfig({
  server: {
    host: '127.0.0.1',
    port: 5180,
    strictPort: true,
    proxy: { '/devtools': { target: process.env['DEVTOOLS_TARGET'] ?? 'http://127.0.0.1:4100' } },
  },
  build: { outDir: 'web-dist' },
});
