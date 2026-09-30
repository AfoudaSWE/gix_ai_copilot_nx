import type { FastifyInstance } from 'fastify';
import type { ToolSecurityManifest } from '@gixcopilot/protocol';
import type { ModelReference, ModelRuntime } from '@gixcopilot/provider';
import { assertApplicationPlane } from '../planes.js';
import { createStudioService } from '../service.js';
import type { StudioService, StudioServiceOptions } from '../service.js';
import { studioPlugin } from './plugin.js';
import type { StudioPluginOptions } from './plugin.js';

export { STUDIO_BASE_PATH, STUDIO_TOKEN_HEADER, studioPlugin } from './plugin.js';
export type { StudioPluginOptions } from './plugin.js';
export { renderStudioPage } from './page.js';
export type { StudioPageOptions } from './page.js';

export type RegisterStudioOptions = StudioServiceOptions & Omit<StudioPluginOptions, 'service'>;

/**
 * Adds the Developer Studio to a Fastify app in development. In production it returns
 * `undefined` without creating the service or registering a route, so `/__gix` and
 * `/__gix/api/*` are 404 and no discovery code is even loaded into use (§6).
 */
export async function registerStudio(app: FastifyInstance, options: RegisterStudioOptions): Promise<StudioService | undefined> {
  if ((options.environment ?? process.env['NODE_ENV']) === 'production') {
    app.log.warn('GIX Developer Studio is development-only and was not registered (NODE_ENV=production).');
    return undefined;
  }
  const service = createStudioService(options);
  await app.register(studioPlugin, { ...options, service });
  return service;
}

/**
 * The parts of a `@gixcopilot/node` `Copilot` the Studio reads. Structural, so the Studio does
 * not depend on `@gixcopilot/node`.
 */
export interface StudioCopilot {
  readonly app: FastifyInstance;
  readonly model: ModelReference;
  readonly modelRuntime: ModelRuntime;
  readonly toolRegistry?: { list(): readonly { readonly name: string; readonly security?: ToolSecurityManifest }[] };
  readonly firewallEnabled: boolean;
}

export type AttachStudioOptions = Partial<RegisterStudioOptions> & {
  readonly root: string;
  /** Whether DevTools is enabled for this copilot (shown in diagnostics). */
  readonly devtools?: boolean;
};

/**
 * Adds the Studio to a copilot created with `createCopilot` (call before `listen()`). The
 * Studio sees the copilot's real model runtime (Test Connection), tool registry (Security view,
 * diagnostics) and firewall, and its live preview talks to the copilot's own routes. At startup
 * it fails fast if an application tool uses a development-plane name (ADR 0023). In production
 * it registers nothing and returns `undefined`.
 */
export async function attachStudio(copilot: StudioCopilot, options: AttachStudioOptions): Promise<StudioService | undefined> {
  if (copilot.toolRegistry) assertApplicationPlane(copilot.toolRegistry);
  const registry = copilot.toolRegistry;
  return registerStudio(copilot.app, {
    model: copilot.model,
    modelRuntime: copilot.modelRuntime,
    copilotRuntimeUrl: '/',
    // Shared with `gix init`, which writes its proposals to .gix/proposals.
    persistProposals: true,
    facts: () => ({ runtime: true, server: true, firewall: copilot.firewallEnabled, devtools: options.devtools ?? false, registeredTools: registry?.list().length ?? 0 }),
    tools: () => (registry?.list() ?? []).map((tool) => ({ name: tool.name, ...(tool.security ? { security: tool.security } : {}) })),
    security: () => ({ firewall: copilot.firewallEnabled }),
    ...options,
  });
}
