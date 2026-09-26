import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import type { DiagnosticEvent, TelemetryMode } from '@gixcopilot/telemetry';
import type { DevToolsRecorder } from '../recorder.js';
import type { DevToolsViewer } from '../types.js';

export interface DevToolsPluginOptions {
  /** Off unless explicitly true (Section 25). */
  readonly enabled: boolean;
  /** Authenticates and authorizes the request - return `false` to reject. Required unless
   * `allowUnauthenticated` is explicitly set (local development only). */
  readonly authorize?: (request: FastifyRequest) => boolean | Promise<boolean>;
  readonly allowUnauthenticated?: boolean;
  /** Scopes what this request may see (tenant, subject) - Section 25, 46, 227. */
  readonly resolveViewer?: (request: FastifyRequest) => DevToolsViewer | Promise<DevToolsViewer>;
  /** DevTools refuses to register when `NODE_ENV` is `production` unless this is set. */
  readonly allowInProduction?: boolean;
  readonly basePath?: string;
  /** Export mode ceiling for `/export` (default `redacted`). */
  readonly exportMode?: TelemetryMode;
}

/**
 * Registers an explicitly enabled, authenticated, READ-ONLY diagnostics endpoint (Section
 * 24-25, 163-164). There is deliberately no route that executes a tool, resumes a workflow,
 * approves anything or mutates state: viewing something in DevTools never grants authority.
 */
export function createDevToolsPlugin(recorder: DevToolsRecorder, options: DevToolsPluginOptions): FastifyPluginAsync {
  return (app) => {
    if (!options.enabled) return Promise.resolve();
    if (process.env['NODE_ENV'] === 'production' && options.allowInProduction !== true) {
      return Promise.reject(new Error('DevTools is disabled in production. Set allowInProduction: true to override deliberately.'));
    }
    if (!options.authorize && options.allowUnauthenticated !== true) {
      return Promise.reject(new Error('DevTools requires authorize, or allowUnauthenticated: true for local development.'));
    }
    const basePath = (options.basePath ?? '/devtools').replace(/\/$/, '');

    const authenticate = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
      if (options.allowUnauthenticated === true) return;
      const allowed = await Promise.resolve(options.authorize?.(request)).catch(() => false);
      if (!allowed) await reply.status(401).send({ error: 'Unauthorized' });
    };
    const viewerOf = async (request: FastifyRequest): Promise<DevToolsViewer | undefined> => options.resolveViewer?.(request);

    app.get(`${basePath}/session`, { preHandler: authenticate }, async (request) => recorder.getSession(await viewerOf(request)));
    app.get<{ Params: { runId: string } }>(`${basePath}/runs/:runId`, { preHandler: authenticate }, async (request, reply) => {
      const run = recorder.getRun(request.params.runId, await viewerOf(request));
      if (!run) return reply.status(404).send({ error: 'Run not found' });
      return run;
    });
    app.get(`${basePath}/export`, { preHandler: authenticate }, async (request) =>
      recorder.exportBundle({ mode: options.exportMode ?? 'redacted', viewer: await viewerOf(request) }),
    );
    app.get(`${basePath}/stream`, { preHandler: authenticate }, async (request, reply) => {
      const viewer = await viewerOf(request);
      reply.hijack();
      reply.raw.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      const unsubscribe = recorder.subscribe((event) => {
        if (!reply.raw.writableEnded && !reply.raw.destroyed) reply.raw.write(formatDiagnosticFrame(event));
      }, viewer);
      reply.raw.on('close', unsubscribe);
      request.raw.on('aborted', unsubscribe);
    });
    return Promise.resolve();
  };
}

/** The same id/event/data SSE framing the server uses, carrying diagnostic payloads. */
export function formatDiagnosticFrame(event: DiagnosticEvent): string {
  return `id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}
