import { defineConfig } from 'vite';

/** `/management` is proxied to the local development backend by default (:4102).
 * Set PLATFORM_API_TARGET to use a separately configured API server instead. */
export default defineConfig({
  server: {
    host: '127.0.0.1',
    port: 5190,
    strictPort: true,
    proxy: { '/management': { target: process.env['PLATFORM_API_TARGET'] ?? 'http://127.0.0.1:4102' } },
  },
  preview: { host: '127.0.0.1', port: 5190, strictPort: true },
  build: { outDir: 'web-dist' },
});
