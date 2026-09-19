import { defineConfig } from 'vite';
export default defineConfig({
  server: {
    host: '127.0.0.1',
    port: 5176,
    strictPort: true,
    proxy: {
      '/api/copilot': {
        target: 'http://127.0.0.1:4320',
        rewrite: (path) => path.replace(/^\/api\/copilot/, ''),
      },
    },
  },
  build: { outDir: 'web-dist' },
});
