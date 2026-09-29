import { randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z, ZodError } from 'zod';
import { ApplyRefusedError } from '../apply/engine.js';
import { redactSecrets } from '../apply/secret-scan.js';
import { copilotSettingsSchema, SYSTEM_INSTRUCTIONS_NOTICE } from '../configuration/copilot-settings.js';
import { DEVELOPMENT_CAPABILITIES } from '../planes.js';
import { ProposalEditError } from '../proposals/edit.js';
import { ProposalStateError } from '../proposals/store.js';
import { StudioApprovalError, StudioNotFoundError } from '../service.js';
import type { StudioService } from '../service.js';
import { WorkspaceViolationError } from '../workspace/guard.js';
import { renderStudioPage } from './page.js';

export const STUDIO_BASE_PATH = '/__gix';
export const STUDIO_TOKEN_HEADER = 'x-gix-studio-token';

export interface StudioPluginOptions {
  readonly service: StudioService;
  /** Host names the Studio answers to (DNS-rebinding protection). Default: loopback only. */
  readonly allowedHosts?: readonly string[];
  /** Extra browser origins allowed to call the API, besides the Studio's own origin. */
  readonly allowedOrigins?: readonly string[];
  /** Optional extra check, e.g. for a shared development machine. */
  readonly authorize?: (request: FastifyRequest) => boolean | Promise<boolean>;
  /** Link shown in the Studio's DevTools section (§80), e.g. the DevTools app URL. */
  readonly devtoolsUrl?: string;
  /** Overrides `process.env.NODE_ENV` (tests). */
  readonly environment?: string;
  /**
   * Same-origin path of the copilot runtime the live preview talks to (Test Copilot), e.g.
   * `/` when the copilot routes share this server or `/api/copilot`. Unset: no runtime.
   */
  readonly copilotRuntimeUrl?: string;
  /** Directory of the built preview bundle. Defaults to the package's own `dist/preview`. */
  readonly previewDirectory?: string;
}

const PREVIEW_TYPES: Readonly<Record<string, string>> = { '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png' };
const PREVIEW_CSP = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data: https:; font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'";

const DEFAULT_HOSTS = ['localhost', '127.0.0.1', '[::1]', '::1'];
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const idParams = z.object({ id: z.string().min(1).max(200) });
const generateBody = z.object({ select: z.array(z.string().max(500)).max(2000).optional() }).strict();
const editBody = z.object({ edits: z.array(z.unknown()).min(1).max(500) }).strict();
const approveBody = z.object({ selection: z.array(z.string().max(500)).max(5000).optional() }).strict();
const copilotBody = z.object({ values: copilotSettingsSchema }).strict();
const DISCOVERY_SECTIONS = ['project', 'apis', 'components', 'context', 'security', 'knowledge'] as const;

function hostName(host: string | undefined): string | undefined {
  if (!host) return undefined;
  return host.startsWith('[') ? host.slice(0, host.indexOf(']') + 1) : host.split(':')[0];
}

function sameToken(expected: Buffer, provided: string | string[] | undefined): boolean {
  if (typeof provided !== 'string') return false;
  const candidate = Buffer.from(provided);
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

/**
 * Registers the Developer Studio at `/__gix` and its API at `/__gix/api/*` (§5-6, §67-68).
 *
 * In production nothing is registered, so both return 404; there is no override, because
 * exposing the development plane in production would need its own design (§4). In
 * development every request must come to a loopback host (or an allowed one), from the
 * Studio's own origin, and carry the per-process token the Studio page embeds. localhost
 * alone is never treated as trusted.
 */
export async function studioPlugin(app: FastifyInstance, options: StudioPluginOptions): Promise<void> {
  const environment = options.environment ?? process.env['NODE_ENV'] ?? 'development';
  if (environment === 'production') {
    app.log.warn('GIX Developer Studio is development-only and was not registered (NODE_ENV=production).');
    return;
  }
  const { service } = options;
  const token = randomBytes(32).toString('base64url');
  const tokenBytes = Buffer.from(token);
  const allowedHosts = new Set([...(options.allowedHosts ?? DEFAULT_HOSTS)].map((host) => host.toLowerCase()));
  const base = STUDIO_BASE_PATH;
  const previewDirectory = `${(options.previewDirectory ?? fileURLToPath(new URL('../preview/', import.meta.url))).replace(/[\\/]+$/, '')}/`;
  const runtimeUrl = options.copilotRuntimeUrl;
  if (runtimeUrl !== undefined && (!runtimeUrl.startsWith('/') || runtimeUrl.startsWith('//'))) throw new Error('copilotRuntimeUrl must be a same-origin path such as "/" or "/api/copilot".');

  const guard = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    void reply.header('Cache-Control', 'no-store').header('X-Content-Type-Options', 'nosniff').header('Referrer-Policy', 'no-referrer').header('X-Frame-Options', 'DENY');
    const host = hostName(request.headers.host)?.toLowerCase();
    if (!host || !allowedHosts.has(host)) {
      await reply.status(403).send({ error: { code: 'HOST_NOT_ALLOWED', message: 'The Studio only answers on an allowed host.' } });
      return;
    }
    const origin = request.headers.origin;
    const ownOrigin = `${request.protocol}://${request.headers.host ?? ''}`;
    if (origin !== undefined && origin !== ownOrigin && !(options.allowedOrigins ?? []).includes(origin)) {
      await reply.status(403).send({ error: { code: 'ORIGIN_NOT_ALLOWED', message: 'Cross-origin requests are not allowed.' } });
      return;
    }
    const fetchSite = request.headers['sec-fetch-site'];
    if (typeof fetchSite === 'string' && !['same-origin', 'none'].includes(fetchSite)) {
      await reply.status(403).send({ error: { code: 'CROSS_SITE', message: 'Cross-site requests are not allowed.' } });
      return;
    }
    if (request.url.startsWith(`${base}/api/`) && !sameToken(tokenBytes, request.headers[STUDIO_TOKEN_HEADER])) {
      await reply.status(403).send({ error: { code: 'STUDIO_TOKEN_REQUIRED', message: 'Missing or invalid Studio token. Reload /__gix.' } });
      return;
    }
    if (MUTATING.has(request.method) && origin === undefined && request.headers.referer?.startsWith(`${ownOrigin}/`) !== true) {
      await reply.status(403).send({ error: { code: 'ORIGIN_REQUIRED', message: 'State-changing requests must come from the Studio page.' } });
      return;
    }
    if (options.authorize && !(await Promise.resolve(options.authorize(request)).catch(() => false))) {
      await reply.status(401).send({ error: { code: 'UNAUTHORIZED', message: 'Not authorized for the Studio.' } });
    }
  };

  await app.register(
    (scope, _pluginOptions, done) => {
      scope.addHook('onRequest', guard);
      scope.setErrorHandler((error, _request, reply) => {
        if (error instanceof ZodError) return reply.status(400).send({ error: { code: 'VALIDATION_FAILED', message: 'Invalid request.', issues: error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })) } });
        if (error instanceof ProposalEditError || error instanceof WorkspaceViolationError) return reply.status(400).send({ error: { code: 'INVALID', message: error.message } });
        if (error instanceof StudioNotFoundError) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: error.message } });
        if (error instanceof StudioApprovalError) return reply.status(409).send({ error: { code: 'APPROVAL_BLOCKED', message: error.message }, proposal: error.proposal });
        if (error instanceof ProposalStateError || error instanceof ApplyRefusedError) return reply.status(409).send({ error: { code: 'CONFLICT', message: error.message } });
        const status = typeof (error as { statusCode?: unknown }).statusCode === 'number' ? (error as { statusCode: number }).statusCode : 500;
        if (status >= 500) scope.log.error({ err: error }, 'Studio request failed');
        return reply.status(status).send({ error: { code: status >= 500 ? 'INTERNAL' : 'BAD_REQUEST', message: status >= 500 ? 'The Studio request failed; see the server log.' : redactSecrets((error as Error).message) } });
      });

      scope.get(base, (_request, reply) => {
        const nonce = randomBytes(16).toString('base64');
        void reply
          .header('Content-Security-Policy', `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; img-src 'self' data: https:; connect-src 'self'; frame-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`)
          .type('text/html; charset=utf-8')
          .send(renderStudioPage({ token, nonce, basePath: base, ...(options.devtoolsUrl ? { devtoolsUrl: options.devtoolsUrl } : {}), ...(runtimeUrl !== undefined ? { copilotRuntimeUrl: runtimeUrl } : {}), systemInstructionsNotice: SYSTEM_INSTRUCTIONS_NOTICE }));
      });
      scope.get(`${base}/`, (_request, reply) => reply.redirect(base));

      // Live preview (§7): the real @gixcopilot/ui, framed by the Studio page only.
      const sendPreview = async (reply: FastifyReply, file: string, type: string): Promise<FastifyReply> => {
        if (!existsSync(`${previewDirectory}index.html`)) return reply.status(503).send({ error: { code: 'PREVIEW_NOT_BUILT', message: 'The preview bundle is missing from this build of @gixcopilot/studio.' } });
        return reply.header('X-Frame-Options', 'SAMEORIGIN').header('Content-Security-Policy', PREVIEW_CSP).type(type).send(await readFile(`${previewDirectory}${file}`));
      };
      scope.get(`${base}/preview`, (_request, reply) => reply.redirect(`${base}/preview/`));
      scope.get(`${base}/preview/`, (_request, reply) => sendPreview(reply, 'index.html', 'text/html; charset=utf-8'));
      scope.get<{ Params: { file: string } }>(`${base}/preview/assets/:file`, async (request, reply) => {
        const { file } = request.params;
        const extension = /\.[a-z0-9]+$/.exec(file)?.[0] ?? '';
        // Only files that exist in the bundle's assets directory, by exact name.
        const assets = await readdir(`${previewDirectory}assets`).catch(() => [] as string[]);
        if (!/^[\w.-]+$/.test(file) || !assets.includes(file) || !PREVIEW_TYPES[extension]) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Not found.' } });
        return sendPreview(reply, `assets/${file}`, PREVIEW_TYPES[extension]);
      });

      const api = `${base}/api`;
      scope.get(`${api}/status`, () => service.status());
      scope.get(`${api}/diagnostics`, () => service.diagnostics());
      scope.get(`${api}/capabilities`, () => ({ plane: 'development', capabilities: DEVELOPMENT_CAPABILITIES, note: 'Development-plane capabilities power the Studio only. They are never application tools, agents or skills (ADR 0023).' }));

      scope.get(`${api}/config`, () => service.config());
      scope.get(`${api}/config/model`, () => service.model.get());
      scope.put(`${api}/config/model`, (request) => service.model.set(request.body));
      scope.post(`${api}/config/model/test`, (_request, reply) => service.testConnection(abortOnClose(reply)));
      scope.post(`${api}/config/copilot`, (request) => {
        const { values } = copilotBody.parse(request.body);
        return service.generate('studio-configuration', { values });
      });

      scope.get(`${api}/discovery`, (_request, reply) => service.latestDiscovery() ?? reply.status(404).send({ error: { code: 'NOT_DISCOVERED', message: 'Run discovery first.' } }));
      scope.post(`${api}/discovery/rescan`, (_request, reply) => service.rescan(abortOnClose(reply)));
      scope.post<{ Params: { section: string } }>(`${api}/discovery/:section`, async (request, reply) => {
        const section = DISCOVERY_SECTIONS.find((name) => name === request.params.section);
        if (!section) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Unknown discovery section.' } });
        const discovery = await service.discover(abortOnClose(reply));
        switch (section) {
          case 'project':
            return discovery;
          case 'apis':
            return { apis: discovery.apis, routes: discovery.routes, diagnostics: discovery.diagnostics };
          case 'components':
            return { components: discovery.components };
          case 'context':
            return { contextCandidates: discovery.contextCandidates };
          case 'security':
            return { authentication: discovery.authentication ?? null, permissions: discovery.permissions };
          case 'knowledge':
            return { knowledgeSources: discovery.knowledgeSources };
        }
      });
      scope.post(`${api}/sync`, (_request, reply) => service.sync(abortOnClose(reply)));

      scope.get(`${api}/generators`, () => service.generators());
      scope.post(`${api}/generators/:id`, (request, reply) => {
        const { id } = idParams.parse(request.params);
        return service.generate(id, generateBody.parse(request.body ?? {}), abortOnClose(reply));
      });

      scope.get(`${api}/proposals`, () => service.proposals());
      scope.get(`${api}/proposals/:id`, (request) => service.proposal(idParams.parse(request.params).id));
      scope.patch(`${api}/proposals/:id`, (request) => service.edit(idParams.parse(request.params).id, editBody.parse(request.body).edits));
      scope.post(`${api}/proposals/:id/approve`, (request) => {
        const { selection } = approveBody.parse(request.body ?? {});
        return service.approve(idParams.parse(request.params).id, selection);
      });
      scope.post(`${api}/proposals/:id/reject`, (request) => service.reject(idParams.parse(request.params).id));
      scope.post(`${api}/proposals/:id/apply`, (request, reply) => service.apply(idParams.parse(request.params).id, abortOnClose(reply)));
      scope.post(`${api}/proposals/:id/rollback`, (request) => service.rollback(idParams.parse(request.params).id));
      done();
    },
    { prefix: '' },
  );
}

/** Aborts long work (discovery, validation) when the browser goes away before the reply. */
function abortOnClose(reply: FastifyReply): AbortSignal {
  const controller = new AbortController();
  reply.raw.once('close', () => {
    if (!reply.raw.writableFinished) controller.abort();
  });
  return controller.signal;
}
