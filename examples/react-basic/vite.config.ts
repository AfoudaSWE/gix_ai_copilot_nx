import { defineConfig } from 'vite';
export default defineConfig({
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: {
      '/api/copilot': {
        target: 'http://127.0.0.1:4318',
        rewrite: (path) => path.replace(/^\/api\/copilot/, ''),
      },
    },
  },
  build: { outDir: 'web-dist' },
});
