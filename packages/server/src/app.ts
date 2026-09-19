import Fastify, { type FastifyInstance } from 'fastify';
import { CopilotError, asRunId, asThreadId } from '@gixcopilot/protocol';
import type { ToolResult } from '@gixcopilot/protocol';
import { createRuntime, type Runtime } from '@gixcopilot/core';
import { createModelExecutor, type ModelRuntime } from '@gixcopilot/provider';
import { createDefaultToolResolver, createStaticToolResolver } from '@gixcopilot/tools';
import type { ToolRegistry } from '@gixcopilot/tools';
import { createRunRegistry } from './run-registry.js';
import { createFrontendToolBridge, type FrontendToolBridge } from './frontend-tool-bridge.js';
import { createToolCallingExecutor } from './tool-calling-executor.js';
import { formatSseComment, formatSseFrame, SSE_RESPONSE_HEADERS } from './sse.js';
import {
  cancelRunParamsSchema,
  createRunRequestSchema,
  submitToolResultParamsSchema,
  submitToolResultRequestSchema,
  type CreateRunRequestBody,
} from './schemas.js';

export interface ToolRuntimeDefaults {
  /** Applied to a tool that declares no `metadata.timeoutMs` of its own. */
  readonly defaultTimeoutMs?: number;
  /** Hard cap on Model -> Tool -> Model rounds within one run (Section 40). Defaults to 8. */
  readonly maxToolIterations?: number;
  /** How long the server waits for a frontend tool result before FRONTEND_TOOL_UNAVAILABLE
   * (Section 51). Omit for no timeout. */
  readonly frontendToolTimeoutMs?: number;
}

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
  /**
   * Backend/native tools (Section 22, added in Phase 5) this server offers to the model.
   * Optional - a server with no toolRegistry and a request with no frontend tools behaves
   * exactly as it did before Phase 5 (plain `createModelExecutor`, no tool-calling loop).
   */
  readonly toolRegistry?: ToolRegistry;
  readonly toolRuntimeDefaults?: ToolRuntimeDefaults;
  readonly logger?: boolean;
}

function buildRun(
  options: CreateServerOptions,
  body: CreateRunRequestBody,
  frontendToolBridge: FrontendToolBridge,
) {
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

  const frontendTools = body.tools ?? [];
  const usesTools = Boolean(options.toolRegistry) || frontendTools.length > 0;

  const executor = usesTools
    ? createToolCallingExecutor({
        modelRuntime: options.modelRuntime,
        model: body.model,
        backendToolResolver: options.toolRegistry
          ? createDefaultToolResolver(options.toolRegistry)
          : createStaticToolResolver([]),
        frontendTools,
        frontendToolBridge,
        maxToolIterations: options.toolRuntimeDefaults?.maxToolIterations,
        frontendToolTimeoutMs: options.toolRuntimeDefaults?.frontendToolTimeoutMs,
        toolTimeoutMs: options.toolRuntimeDefaults?.defaultTimeoutMs,
      })
    : createModelExecutor({ runtime: options.modelRuntime, model: body.model });

  return {
    ok: true as const,
    run: createRuntime({ executor }).run({ threadId, messages: body.messages }),
  };
}

/**
 * Builds (but does not start listening on) a Fastify app exposing the HTTP API:
 *   GET  /health
 *   POST /runs                        - creates a run and streams its events back as SSE
 *   POST /runs/:runId/cancel          - cancels an in-flight run by id
 *   POST /runs/:runId/tool-results    - submits a frontend tool's result (Phase 5, Section 50)
 *
 * See docs/adr/0004-sse-as-initial-streaming-transport.md for why run-creation and
 * streaming are combined into a single request/response instead of a separate
 * create-then-subscribe flow.
 */
export function createServer(options: CreateServerOptions): FastifyInstance {
  const app = Fastify({ logger: options.logger ?? false });
  const registry = createRunRegistry();
  const frontendToolBridge = createFrontendToolBridge();

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

    const built = buildRun(options, parsed.data, frontendToolBridge);
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

  app.post('/runs/:runId/tool-results', async (request, reply) => {
    const parsedParams = submitToolResultParamsSchema.safeParse(request.params);
    if (!parsedParams.success) {
      const error = CopilotError.validation('Invalid runId path parameter');
      await reply.status(400).send({ error: error.toPublicJSON() });
      return;
    }
    const parsedBody = submitToolResultRequestSchema.safeParse(request.body);
    if (!parsedBody.success) {
      const error = CopilotError.validation('Invalid tool result body', {
        issueCount: parsedBody.error.issues.length,
      });
      await reply.status(400).send({ error: error.toPublicJSON() });
      return;
    }

    const runId = asRunId(parsedParams.data.runId);
    // The parsed shape structurally matches ToolResult; `code` is a plain string on the wire
    // (see schemas.ts) - the exact same "trust the boundary" convention as `asRunId`/
    // `asThreadId` elsewhere in this file.
    const accepted = frontendToolBridge.submitResult(
      runId,
      parsedBody.data.toolCallId,
      parsedBody.data.result as ToolResult,
    );
    if (!accepted) {
      const error = CopilotError.validation(
        'No pending frontend tool call with that runId/toolCallId (it may have already been ' +
          'resolved, timed out, or the run may have ended).',
        { runId, toolCallId: parsedBody.data.toolCallId },
      );
      await reply.status(404).send({ error: error.toPublicJSON() });
      return;
    }

    await reply.status(202).send({ status: 'accepted' as const });
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
