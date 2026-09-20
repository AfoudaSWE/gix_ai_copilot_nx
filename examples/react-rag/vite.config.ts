import { defineConfig } from 'vite';
export default defineConfig({ server: { host: '127.0.0.1', port: 5180, strictPort: true, proxy: { '/api': { target: 'http://127.0.0.1:4324', rewrite: (path) => path.replace(/^\/api/, '') } } }, build: { outDir: 'web-dist' } });
