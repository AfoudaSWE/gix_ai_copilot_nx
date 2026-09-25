import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import type { DiagnosticEvent } from '@gixcopilot/telemetry';
import type { DevToolsRecorder } from '../recorder.js';

export interface DevToolsPluginOptions {
  readonly enabled: boolean;
  readonly authorize?: (request: FastifyRequest) => boolean | Promise<boolean>;
  readonly allowUnauthenticated?: boolean;
  readonly basePath?: string;
}

/** Register an explicitly enabled, authenticated read-only diagnostics endpoint. */
export function createDevToolsPlugin(recorder: DevToolsRecorder, options: DevToolsPluginOptions): FastifyPluginAsync {
  return async (app) => {
    if (!options.enabled) return;
    if (!options.authorize && options.allowUnauthenticated !== true) {
      throw new Error('DevTools requires authorize or allowUnauthenticated: true when enabled.');
    }
    const basePath = (options.basePath ?? '/devtools').replace(/\/$/, '');
    const authenticate = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
      if (options.allowUnauthenticated === true || await options.authorize?.(request)) return;
      await reply.status(401).send({ error: 'Unauthorized' });
    };

    app.get(`${basePath}/session`, { preHandler: authenticate }, () => recorder.getSession());
    app.get<{ Params: { runId: string } }>(`${basePath}/runs/:runId`, { preHandler: authenticate }, async (request, reply) => {
      const run = recorder.getRun(request.params.runId);
      if (!run) return reply.status(404).send({ error: 'Run not found' });
      return run;
    });
    app.get(`${basePath}/export`, { preHandler: authenticate }, () => recorder.exportBundle());
    app.get(`${basePath}/stream`, { preHandler: authenticate }, (request, reply) => {
      reply.hijack();
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      const unsubscribe = recorder.subscribe((event) => {
        if (!reply.raw.writableEnded && !reply.raw.destroyed) reply.raw.write(formatDiagnosticFrame(event));
      });
      reply.raw.on('close', unsubscribe);
      request.raw.on('aborted', unsubscribe);
    });
  };
}

/** The same id/event/data SSE framing used by the server, with diagnostic payloads. */
export function formatDiagnosticFrame(event: DiagnosticEvent): string {
  return `id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}
