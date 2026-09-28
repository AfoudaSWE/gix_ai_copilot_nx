import { defineConfig } from 'vite';

export default defineConfig({
  root: 'web',
  server: {
    host: '127.0.0.1',
    port: 5178,
    // '/api/copilot' must come before '/api': Vite uses the first matching key.
    proxy: {
      '/api/copilot': {
        target: 'http://127.0.0.1:4325',
        rewrite: (path) => path.replace(/^\/api\/copilot/, ''),
      },
      '/api': 'http://127.0.0.1:4319',
    },
  },
  build: { outDir: '../web-dist', emptyOutDir: true },
});
