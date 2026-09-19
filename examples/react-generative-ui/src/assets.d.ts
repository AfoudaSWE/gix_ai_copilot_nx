/// <reference types="vite/client" />

declare module '*.css';

/**
 * Only the model *name* is ever forwarded into the browser bundle (via `vite.config.ts`'s
 * `loadEnv`) - `OPENAI_API_KEY` is never declared here and never reachable from client code.
 */
interface ImportMetaEnv {
  readonly VITE_OPENAI_MODEL?: string;
}
