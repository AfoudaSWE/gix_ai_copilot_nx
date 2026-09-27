/**
 * Site-wide configuration. Deployment-specific values come from build-time environment
 * variables so nothing (domain, repository) is hard-coded into components.
 */
const env = (import.meta as { env?: Record<string, string | undefined> }).env ?? {};

export const SITE = {
  name: 'GIX AI',
  product: 'GIX AI Copilot SDK',
  /** Canonical origin used for canonical URLs, OpenGraph and the sitemap. */
  url: (env['VITE_SITE_URL'] ?? 'https://ai.gixtechnology.com').replace(/\/$/, ''),
  /** Public source repository (the `repository` field every package publishes). */
  github: env['VITE_GITHUB_URL'] ?? 'https://github.com/AfoudaSWE/gix_ai_copilot_nx',
  branch: env['VITE_GITHUB_BRANCH'] ?? 'main',
  company: { name: 'GIX Technology', url: 'https://gixtechnology.com' },
  npm: 'https://www.npmjs.com/org/gixcopilot',
  version: '0.1.0',
  description:
    'GIX AI is an enterprise SDK for building application-aware AI copilots and agents with tools, context, RAG, generative UI, workflows and built-in security.',
} as const;

/** Link to a file in the repository (for "Edit this page" and source links). */
export function repoFile(path: string, mode: 'blob' | 'edit' = 'blob'): string {
  return `${SITE.github}/${mode}/${SITE.branch}/${path.replace(/^\/+/, '')}`;
}
