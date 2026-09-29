import { defineConfig } from 'vite';

/** Relative asset URLs: the Studio plugin serves this bundle under /__gix/preview/. */
export default defineConfig({
  base: './',
  build: { outDir: 'web-dist', emptyOutDir: true },
});
