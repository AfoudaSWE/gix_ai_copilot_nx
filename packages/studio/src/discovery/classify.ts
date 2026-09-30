import { BACKEND_FRAMEWORKS, FRONTEND_FRAMEWORKS } from './detectors.js';
import type { DiscoveredProject, FrameworkId } from './model.js';

export type ProjectClassification = 'FRONTEND_ONLY' | 'BACKEND_ONLY' | 'FULL_STACK' | 'MONOREPO' | 'NX_MONOREPO' | 'MULTI_APP' | 'UNKNOWN';

export type ApplicationRole = 'frontend' | 'backend' | 'full-stack' | 'unknown';

export interface ClassifiedApplication {
  readonly name: string;
  readonly path: string;
  readonly role: ApplicationRole;
  /** The UI framework the installer targets, when this is (also) a frontend. */
  readonly ui?: 'react' | 'angular' | 'vue' | 'nextjs';
  readonly backend?: 'fastify' | 'express' | 'nestjs' | 'node' | 'nextjs';
  readonly frameworks: readonly FrameworkId[];
}

export interface ProjectClassificationResult {
  readonly classification: ProjectClassification;
  readonly applications: readonly ClassifiedApplication[];
  readonly frontends: readonly ClassifiedApplication[];
  readonly backends: readonly ClassifiedApplication[];
  /** One line per application, for the installer's report (§4). */
  readonly summary: readonly string[];
}

function roleOf(frameworks: readonly FrameworkId[]): Pick<ClassifiedApplication, 'role' | 'ui' | 'backend'> {
  const next = frameworks.includes('nextjs');
  const ui = next ? 'nextjs' : frameworks.includes('angular') ? 'angular' : frameworks.includes('vue') ? 'vue' : frameworks.includes('react') ? 'react' : undefined;
  const backend = next ? 'nextjs' : frameworks.includes('nestjs') ? 'nestjs' : frameworks.includes('fastify') ? 'fastify' : frameworks.includes('express') ? 'express' : frameworks.includes('node') ? 'node' : undefined;
  const isFrontend = frameworks.some((id) => FRONTEND_FRAMEWORKS.has(id));
  const isBackend = frameworks.some((id) => BACKEND_FRAMEWORKS.has(id)) || next;
  const role: ApplicationRole = isFrontend && isBackend ? 'full-stack' : isFrontend ? 'frontend' : isBackend ? 'backend' : 'unknown';
  return { role, ...(ui ? { ui } : {}), ...(backend && isBackend ? { backend } : {}) };
}

/**
 * Normalizes a discovered repository into one classification (§5) and a role per application
 * (§4). The installer's strategy follows from it; nothing about the structure is assumed.
 */
export function classifyProject(project: Pick<DiscoveredProject, 'workspace' | 'applications'>): ProjectClassificationResult {
  const applications = project.applications.map((app): ClassifiedApplication => ({ name: app.name, path: app.path, frameworks: app.frameworks, ...roleOf(app.frameworks) }));
  const frontends = applications.filter((app) => app.role === 'frontend' || app.role === 'full-stack');
  const backends = applications.filter((app) => app.role === 'backend' || app.role === 'full-stack');
  let classification: ProjectClassification;
  if (project.workspace.kind === 'nx') classification = 'NX_MONOREPO';
  else if ((project.workspace.kind === 'pnpm-workspaces' || project.workspace.kind === 'npm-workspaces') && applications.length > 1) classification = 'MONOREPO';
  else if (frontends.length > 1 || backends.length > 1) classification = 'MULTI_APP';
  else if (applications.some((app) => app.role === 'full-stack') || (frontends.length > 0 && backends.length > 0)) classification = 'FULL_STACK';
  else if (frontends.length > 0) classification = 'FRONTEND_ONLY';
  else if (backends.length > 0) classification = 'BACKEND_ONLY';
  else classification = 'UNKNOWN';
  return {
    classification,
    applications,
    frontends,
    backends,
    summary: applications.map((app) => `${app.path === '.' ? '(root)' : app.path}  ${app.role}  ${[app.ui, app.backend].filter(Boolean).join(' + ') || app.frameworks.join(', ') || 'no framework detected'}`),
  };
}
