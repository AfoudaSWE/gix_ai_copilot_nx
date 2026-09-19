import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { CopilotError, asRunId, asThreadId } from '@gixcopilot/protocol';
import type { ToolResult } from '@gixcopilot/protocol';
import { createRuntime, type Runtime } from '@gixcopilot/core';
import { createModelExecutor, type ModelRuntime } from '@gixcopilot/provider';
import { createDefaultToolResolver, createStaticToolResolver, toToolManifest } from '@gixcopilot/tools';
import type { ToolRegistry } from '@gixcopilot/tools';
import {
  canApprove,
  ApprovalConflictError,
  createPermissionAwareToolResolver,
  hasAllPermissions,
  hasPermission,
} from '@gixcopilot/security';
import type {
  ActionFirewall,
  ApprovalStore,
  ApprovalRequest,
  AuditRecord,
  AuthenticationAdapter,
  DataPolicy,
  RolePermissionMap,
  SecurityContext,
} from '@gixcopilot/security';
import { createRunRegistry } from './run-registry.js';
import { createFrontendToolBridge, type FrontendToolBridge } from './frontend-tool-bridge.js';
import { createToolCallingExecutor } from './tool-calling-executor.js';
import { formatSseComment, formatSseFrame, SSE_RESPONSE_HEADERS } from './sse.js';
import {
  approvalIdParamsSchema,
  cancelRunParamsSchema,
  createRunRequestSchema,
  decideApprovalRequestSchema,
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
  /** Trusted contracts for browser tools. Required when the firewall is enabled. */
  readonly frontendToolRegistry?: ToolRegistry;
  /** Safe, tenant-scoped history from the configured audit adapter. */
  readonly actionHistory?: { list(): readonly AuditRecord[] };
  readonly toolRuntimeDefaults?: ToolRuntimeDefaults;
  readonly logger?: boolean;
  /**
   * Phase 7 (Section 13-14): resolves the trusted identity for each `POST /runs` request.
   * Omitted entirely, every run executes with an unauthenticated `SecurityContext` ({}) -
   * fine for a server with no `actionFirewall` configured (Phase 5/6 behavior, unchanged),
   * but any consequential action then fails closed (AUTHENTICATION_REQUIRED) once a firewall
   * is added, per the fail-closed default (Section 27).
   */
  readonly authenticationAdapter?: AuthenticationAdapter;
  /** Section 70-72 - the mandatory gateway for every tool call when configured. */
  readonly actionFirewall?: ActionFirewall;
  /** Required for any tool whose risk policy can resolve to an approval level above `none`. */
  readonly approvals?: ApprovalStore;
  readonly roleMap?: RolePermissionMap;
  readonly approvalExpiresInMs?: number;
  /** Section 56 - redacts a backend tool's successful result before it reaches the model or client. */
  readonly dataPolicy?: DataPolicy;
}

function buildRun(
  options: CreateServerOptions,
  body: CreateRunRequestBody,
  frontendToolBridge: FrontendToolBridge,
  securityContext: SecurityContext,
  requestContext: unknown,
) {
  const threadId = body.threadId !== undefined ? asThreadId(body.threadId) : undefined;

  if (!body.model && !body.action) {
    return { ok: true as const, run: options.runtime.run({ threadId, messages: body.messages }) };
  }

  if (!options.modelRuntime && !body.action) {
    return {
      ok: false as const,
      error: CopilotError.validation('This server is not configured for model execution.', {
        provider: body.model?.provider,
      }),
    };
  }

  // Section 20's discovery boundary: a client-declared frontend tool the caller's identity
  // cannot use is dropped before it ever reaches the model - the exact same rule backend
  // tools get via `createPermissionAwareToolResolver` below.
  const trustedFrontend = toToolManifest(options.frontendToolRegistry?.list() ?? []);
  const candidates = options.actionFirewall
    ? trustedFrontend.filter((entry) => body.tools?.some((candidate) => candidate.name === entry.name))
    : (body.tools ?? []);
  const frontendTools = candidates.filter((entry) =>
    !options.toolRegistry?.list().some((tool) => tool.name === entry.name) &&
    hasAllPermissions(securityContext.identity, entry.security?.requiredPermissions ?? [], options.roleMap),
  );
  const usesTools = Boolean(options.toolRegistry) || frontendTools.length > 0 || Boolean(body.action) || Boolean(options.dataPolicy) || Boolean(options.actionFirewall);

  const rawBackendToolResolver = options.toolRegistry
    ? createDefaultToolResolver(options.toolRegistry)
    : createStaticToolResolver([]);
  const backendToolResolver = {
    async resolve(context: Parameters<ReturnType<typeof createDefaultToolResolver>['resolve']>[0]) {
      const current = options.actionFirewall ? await resolveSecurityContext(options, requestContext) : securityContext;
      return createPermissionAwareToolResolver(rawBackendToolResolver, current.identity, { roleMap: options.roleMap }).resolve(context);
    },
  };

  const executor = usesTools
    ? createToolCallingExecutor({
        modelRuntime: options.modelRuntime,
        model: body.model,
        action: body.action,
        frontendDefinitions: options.frontendToolRegistry?.list(),
        backendToolResolver,
        // Unfiltered (Section 21 defense in depth) - see tool-calling-executor.ts's doc
        // comment on `securityToolResolver`: a tool hidden from discovery still needs its
        // security metadata visible to the firewall so a manually-constructed call for it
        // is correctly DENIED, not silently treated as unclassified.
        securityToolResolver: rawBackendToolResolver,
        frontendTools,
        frontendToolBridge,
        maxToolIterations: options.toolRuntimeDefaults?.maxToolIterations,
        frontendToolTimeoutMs: options.toolRuntimeDefaults?.frontendToolTimeoutMs,
        toolTimeoutMs: options.toolRuntimeDefaults?.defaultTimeoutMs,
        actionFirewall: options.actionFirewall,
        approvals: options.approvals,
        securityContext,
        refreshSecurityContext: () => resolveSecurityContext(options, requestContext),
        approvalExpiresInMs: options.approvalExpiresInMs,
        dataPolicy: options.dataPolicy,
      })
    : createModelExecutor({ runtime: options.modelRuntime as ModelRuntime, model: body.model });

  return {
    ok: true as const,
    run: createRuntime({ executor }).run({ threadId, messages: body.messages }),
  };
}

/** Section 13: identity comes only from the trusted server-side authentication adapter -
 * never from client/model-supplied fields. Tenant is derived from `identity.attributes.
 * tenantId` when present (Section 15) - kept out of `AuthenticationAdapter`'s own signature
 * so it stays a single, simple method (Section 14's literal contract). */
async function resolveSecurityContext(
  options: CreateServerOptions,
  requestContext: unknown,
): Promise<SecurityContext> {
  if (!options.authenticationAdapter) return {};
  const identity = await options.authenticationAdapter.authenticate(requestContext);
  if (!identity) return {};
  const tenantId = identity.attributes?.['tenantId'];
  return {
    identity,
    ...(typeof tenantId === 'string' ? { tenant: { tenantId } } : {}),
  };
}

/** Section 76-83: an identity may see/list approvals it could act on (holds *any*
 * `approvals.*` permission) or that it itself requested - never every approval in the system
 * merely because the caller is authenticated. */
function canViewApproval(
  options: CreateServerOptions,
  securityContext: SecurityContext,
  approval: ApprovalRequest,
): boolean {
  const identity = securityContext.identity;
  if (!identity || securityContext.tenant?.tenantId !== approval.tenantId) return false;
  if (approval.requestedBy === identity.subject) return true;
  return ['approvals.user-confirmation', 'approvals.supervisor', 'approvals.admin', 'approvals.two-person'].some(
    (permission) => hasPermission(identity, permission, options.roleMap),
  );
}

/**
 * Builds (but does not start listening on) a Fastify app exposing the HTTP API:
 *   GET  /health
 *   POST /runs                        - creates a run and streams its events back as SSE
 *   POST /runs/:runId/cancel          - cancels an in-flight run by id
 *   POST /runs/:runId/tool-results    - submits a frontend tool's result (Phase 5, Section 50)
 *   GET  /approvals                   - lists approvals visible to the caller (Phase 7)
 *   GET  /approvals/:approvalId       - reads one approval visible to the caller (Phase 7)
 *   POST /approvals/:approvalId/approve - approves a pending action (Phase 7, Section 83)
 *   POST /approvals/:approvalId/reject  - rejects a pending action (Phase 7, Section 83)
 *
 * See docs/adr/0004-sse-as-initial-streaming-transport.md for why run-creation and
 * streaming are combined into a single request/response instead of a separate
 * create-then-subscribe flow.
 */
export function createServer(options: CreateServerOptions): FastifyInstance {
  const app = Fastify({ logger: options.logger ?? false });
  const registry = createRunRegistry();
  const frontendToolBridge = createFrontendToolBridge();
  const owners = new Map<string, SecurityContext>();

  async function ownsRun(request: FastifyRequest, reply: FastifyReply, runId: string): Promise<boolean> {
    if (!options.actionFirewall && !options.authenticationAdapter) return true;
    const caller = await resolveSecurityContext(options, request);
    const owner = owners.get(runId);
    if (!caller.identity || caller.identity.subject !== owner?.identity?.subject ||
        caller.tenant?.tenantId !== owner?.tenant?.tenantId) {
      await reply.status(403).send({ error: CopilotError.permissionDenied('access this run').toPublicJSON() });
      return false;
    }
    return true;
  }

  app.get('/actions', async (request, reply) => {
    const caller = await resolveSecurityContext(options, request);
    if (!caller.identity) return reply.status(401).send({ error: CopilotError.authenticationRequired().toPublicJSON() });
    const records = (options.actionHistory?.list() ?? []).filter((record) =>
      record.tenantId === caller.tenant?.tenantId &&
      (record.actor.subject === caller.identity?.subject || hasPermission(caller.identity, 'audit.read', options.roleMap)),
    );
    return { actions: records.slice(-100) };
  });

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

    const securityContext = await resolveSecurityContext(options, request);
    const built = buildRun(options, parsed.data, frontendToolBridge, securityContext, request);
    if (!built.ok) {
      await reply.status(400).send({ error: built.error.toPublicJSON() });
      return;
    }
    const { run } = built;

    registry.register(run);
    owners.set(run.runId, securityContext);
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
      owners.delete(run.runId);
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

    if (!await ownsRun(request, reply, parsedParams.data.runId)) return;
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

    if (!await ownsRun(request, reply, parsedParams.data.runId)) return;
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

  app.get('/approvals', async (request, reply) => {
    if (!options.approvals) {
      await reply.status(404).send({ error: CopilotError.validation('This server has no approval store configured.').toPublicJSON() });
      return;
    }
    const securityContext = await resolveSecurityContext(options, request);
    if (!securityContext.identity) {
      await reply.status(401).send({ error: CopilotError.authenticationRequired().toPublicJSON() });
      return;
    }
    const all = await options.approvals.list();
    const visible = all.filter((approval) => canViewApproval(options, securityContext, approval));
    await reply.status(200).send({ approvals: visible });
  });

  app.get('/approvals/:approvalId', async (request, reply) => {
    if (!options.approvals) {
      await reply.status(404).send({ error: CopilotError.validation('This server has no approval store configured.').toPublicJSON() });
      return;
    }
    const parsedParams = approvalIdParamsSchema.safeParse(request.params);
    if (!parsedParams.success) {
      await reply.status(400).send({ error: CopilotError.validation('Invalid approvalId path parameter').toPublicJSON() });
      return;
    }
    const approval = await options.approvals.get(parsedParams.data.approvalId);
    if (!approval) {
      await reply.status(404).send({ error: CopilotError.validation('No approval with that id.').toPublicJSON() });
      return;
    }
    const securityContext = await resolveSecurityContext(options, request);
    if (!canViewApproval(options, securityContext, approval)) {
      await reply.status(403).send({ error: CopilotError.permissionDenied('view this approval').toPublicJSON() });
      return;
    }
    await reply.status(200).send({ approval });
  });

  async function decideApproval(
    request: FastifyRequest,
    reply: FastifyReply,
    decision: 'approve' | 'reject',
  ): Promise<void> {
    if (!options.approvals) {
      await reply.status(404).send({ error: CopilotError.validation('This server has no approval store configured.').toPublicJSON() });
      return;
    }
    const parsedParams = approvalIdParamsSchema.safeParse(request.params);
    if (!parsedParams.success) {
      await reply.status(400).send({ error: CopilotError.validation('Invalid approvalId path parameter').toPublicJSON() });
      return;
    }
    const parsedBody = decideApprovalRequestSchema.safeParse(request.body ?? {});
    if (!parsedBody.success) {
      await reply.status(400).send({ error: CopilotError.validation('Invalid request body').toPublicJSON() });
      return;
    }
    const approval = await options.approvals.get(parsedParams.data.approvalId);
    if (!approval) {
      await reply.status(404).send({ error: CopilotError.validation('No approval with that id.').toPublicJSON() });
      return;
    }
    const securityContext = await resolveSecurityContext(options, request);
    if (!securityContext.identity) {
      await reply.status(401).send({ error: CopilotError.authenticationRequired().toPublicJSON() });
      return;
    }
    // Section 27 (hitl skill): approving/rejecting is itself authorized - a SUPERVISOR_APPROVAL
    // must not be resolvable by an unprivileged user, regardless of what the request body claims.
    const isRequester = approval.requestedBy === securityContext.identity.subject;
    if (securityContext.tenant?.tenantId !== approval.tenantId ||
        (approval.approvalLevel === 'user-confirmation' ? !isRequester : isRequester) ||
        !canApprove(securityContext.identity, approval.approvalLevel, options.roleMap)) {
      await reply.status(403).send({ error: CopilotError.permissionDenied(`${decision} this approval`).toPublicJSON() });
      return;
    }
    if (parsedBody.data.revision !== undefined && parsedBody.data.revision !== approval.revision) {
      await reply.status(409).send({ error: CopilotError.validation('Approval revision changed. Refresh before deciding.').toPublicJSON() });
      return;
    }
    await options.actionFirewall?.record?.({
      id: globalThis.crypto.randomUUID(), timestamp: new Date().toISOString(),
      tenantId: approval.tenantId, actor: { kind: 'user', subject: securityContext.identity.subject },
      action: decision, runId: approval.runId, toolCallId: approval.toolCallId,
      decision: `approval.${decision}`, approval: { approvalId: approval.approvalId, status: approval.status },
    });
    const updated =
      decision === 'approve'
        ? await options.approvals.approve(approval.approvalId, securityContext.identity.subject, parsedBody.data.comment, new Date(), parsedBody.data.revision)
        : await options.approvals.reject(approval.approvalId, securityContext.identity.subject, parsedBody.data.comment, new Date(), parsedBody.data.revision);
    await reply.status(200).send({ approval: updated });
  }

  app.post('/approvals/:approvalId/approve', (request, reply) => decideApproval(request, reply, 'approve'));
  app.post('/approvals/:approvalId/reject', (request, reply) => decideApproval(request, reply, 'reject'));

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ApprovalConflictError) {
      void reply.status(409).send({ error: CopilotError.validation(error.message).toPublicJSON() });
      return;
    }
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
