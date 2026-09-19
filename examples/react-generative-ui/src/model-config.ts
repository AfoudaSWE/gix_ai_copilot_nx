/**
 * Client-safe model configuration - deliberately has no `@gixcopilot/server`,
 * `@gixcopilot/provider-openai`, `@gixcopilot/tools`, or other Node-only import, so browser
 * code (`app.tsx`) can import it without pulling `fastify`/Node built-ins into the Vite
 * client bundle (unlike `backend.ts`, which is server-only and must never be imported from
 * browser-reachable code).
 */
export const OPENAI_DEFAULT_MODEL = 'gpt-4o-mini';
