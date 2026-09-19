import { defineConfig, loadEnv } from 'vite';

/**
 * `loadEnv` reads the same `.env` file the server process reads (`node --env-file-if-
 * exists=.env`) - but this config forwards only `OPENAI_MODEL` into the browser bundle,
 * never `OPENAI_API_KEY`. `OPENAI_API_KEY` is not referenced anywhere in this file or in
 * any browser-reachable source; see the security section of README.md.
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    define: {
      'import.meta.env.VITE_OPENAI_MODEL': JSON.stringify(env['OPENAI_MODEL'] ?? ''),
    },
    server: {
      host: '127.0.0.1',
      port: 5177,
      strictPort: true,
      proxy: {
        '/api/copilot': {
          target: 'http://127.0.0.1:4321',
          rewrite: (path) => path.replace(/^\/api\/copilot/, ''),
        },
      },
    },
    build: { outDir: 'web-dist' },
  };
});
