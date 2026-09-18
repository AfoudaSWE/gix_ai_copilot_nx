import Fastify, { type FastifyInstance } from 'fastify';
import { CopilotError, asRunId, asThreadId } from '@gixcopilot/protocol';
import { createRuntime, type Runtime } from '@gixcopilot/core';
import { createModelExecutor, type ModelRuntime } from '@gixcopilot/provider';
import { createRunRegistry } from './run-registry.js';
import { formatSseComment, formatSseFrame, SSE_RESPONSE_HEADERS } from './sse.js';
import {
  cancelRunParamsSchema,
  createRunRequestSchema,
  type CreateRunRequestBody,
} from './schemas.js';

export interface CreateServerOptions {
  /**
   * The runtime a request without a `model` field executes against (Phase 1 behavior, e.g.
   * the deterministic echo executor). The server has no opinion on what executor backs it -
   * dependency injection, per the node-backend skill - so it never embeds AI/business logic
   * itself. Pass `createRuntime({ executor: ... })` from @gixcopilot/core.
   */
  readonly runtime: Runtime;
  /**
   * Enables the `model` field on `POST /runs` (Section 37). Optional - a server with no
   * modelRuntime configured still works for the Phase 1 default-executor path; a request
   * that names a `model` on such a server gets a clear 400, not a crash.
   */
  readonly modelRuntime?: ModelRuntime;
  readonly logger?: boolean;
}

function buildRun(options: CreateServerOptions, body: CreateRunRequestBody) {
  const threadId = body.threadId !== undefined ? asThreadId(body.threadId) : undefined;

  if (!body.model) {
    return { ok: true as const, run: options.runtime.run({ threadId, messages: body.messages }) };
  }

  if (!options.modelRuntime) {
    return {
      ok: false as const,
      error: CopilotError.validation('This server is not configured for model execution.', {
        provider: body.model.provider,
      }),
    };
  }

  const executor = createModelExecutor({ runtime: options.modelRuntime, model: body.model });
  return {
    ok: true as const,
    run: createRuntime({ executor }).run({ threadId, messages: body.messages }),
  };
}

/**
 * Builds (but does not start listening on) a Fastify app exposing the Phase 1 HTTP API:
 *   GET  /health
 *   POST /runs                  - creates a run and streams its events back as SSE
 *   POST /runs/:runId/cancel    - cancels an in-flight run by id
 *
 * See docs/adr/0004-sse-as-initial-streaming-transport.md for why run-creation and
 * streaming are combined into a single request/response instead of a separate
 * create-then-subscribe flow.
 */
export function createServer(options: CreateServerOptions): FastifyInstance {
  const app = Fastify({ logger: options.logger ?? false });
  const registry = createRunRegistry();

  app.get('/health', () => ({ status: 'ok' as const }));

  app.post('/runs', async (request, reply) => {
    const parsed = createRunRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      const error = CopilotError.validation('Invalid run request body', {
        issueCount: parsed.error.issues.length,
      });
      await reply.status(400).send({ error: error.toPublicJSON() });
      return;
    }

    const built = buildRun(options, parsed.data);
    if (!built.ok) {
      await reply.status(400).send({ error: built.error.toPublicJSON() });
      return;
    }
    const { run } = built;

    registry.register(run);
    reply.hijack();
    reply.raw.writeHead(200, SSE_RESPONSE_HEADERS);

    // Listen on the RESPONSE stream, not the request stream: `request.raw`'s 'close' fires
    // as soon as the (tiny) request body has been fully read, which happens well before we
    // finish streaming the response - listening there would cancel every run almost
    // immediately. `reply.raw`'s 'close' fires when the underlying connection tears down;
    // the `writableEnded` check distinguishes "client disconnected early" from "we already
    // finished and are now seeing the connection's own normal teardown."
    const onResponseClosed = (): void => {
      if (!reply.raw.writableEnded) {
        run.cancel();
      }
    };
    reply.raw.on('close', onResponseClosed);

    try {
      for await (const event of run.events) {
        reply.raw.write(formatSseFrame(event));
      }
    } catch (error) {
      request.log.error({ err: error }, 'Unexpected error while streaming run events');
      reply.raw.write(formatSseComment('internal error - closing stream'));
    } finally {
      reply.raw.off('close', onResponseClosed);
      registry.unregister(run.runId);
      reply.raw.end();
    }
  });

  app.post('/runs/:runId/cancel', async (request, reply) => {
    const parsedParams = cancelRunParamsSchema.safeParse(request.params);
    if (!parsedParams.success) {
      const error = CopilotError.validation('Invalid runId path parameter');
      await reply.status(400).send({ error: error.toPublicJSON() });
      return;
    }

    const run = registry.get(asRunId(parsedParams.data.runId));
    if (!run) {
      const error = CopilotError.validation('No in-flight run with that id', {
        runId: parsedParams.data.runId,
      });
      await reply.status(404).send({ error: error.toPublicJSON() });
      return;
    }

    run.cancel();
    await reply.status(202).send({ status: 'cancelling' as const });
  });

  app.setErrorHandler((error, request, reply) => {
    request.log.error({ err: error }, 'Unhandled route error');
    const publicError = CopilotError.internal('Unexpected server error').toPublicJSON();
    void reply.status(500).send({ error: publicError });
  });

  registerShutdownHook(app, registry);

  return app;
}

function registerShutdownHook(
  app: FastifyInstance,
  registry: ReturnType<typeof createRunRegistry>,
): void {
  app.addHook('onClose', (_instance, done) => {
    registry.cancelAll();
    done();
  });
}
