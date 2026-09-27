import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AuthenticationAdapter } from '@gixcopilot/security';
import { RESOURCE_KINDS } from './resources.js';
import type { ResourceKind } from './resources.js';
import { ManagementError } from './service.js';
import type { Actor, ManagementService } from './service.js';

export interface ManagementPluginOptions {
  /** Required: every route authenticates. There is no anonymous management access. */
  readonly authentication: AuthenticationAdapter;
  /** Identity permission that marks platform administrators (default `platform.admin`). */
  readonly platformAdminPermission?: string;
}

type Handler = (actor: Actor, request: FastifyRequest) => Promise<unknown>;

const params = (request: FastifyRequest): Record<string, string> => (request.params ?? {}) as Record<string, string>;
const query = (request: FastifyRequest): Record<string, string | undefined> => (request.query ?? {}) as Record<string, string | undefined>;

function body<T>(schema: z.ZodType<T>, request: FastifyRequest): T {
  const parsed = schema.safeParse(request.body);
  if (!parsed.success) throw new ManagementError(400, 'VALIDATION_ERROR', `Invalid request body: ${parsed.error.issues.map((issue) => `${issue.path.join('.') || '(root)'} ${issue.message}`).join('; ')}`);
  return parsed.data;
}

const kindParam = (value: string | undefined): ResourceKind | undefined => {
  if (value === undefined) return undefined;
  if (!(RESOURCE_KINDS as readonly string[]).includes(value)) throw new ManagementError(400, 'VALIDATION_ERROR', 'Unknown resource kind.');
  return value as ResourceKind;
};

const version = (value: string | undefined): number => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new ManagementError(400, 'VALIDATION_ERROR', 'Invalid version.');
  return parsed;
};

/**
 * The management HTTP API, `/management/v1/...` (Section 79-80). Register it with a prefix:
 * `app.register(createManagementPlugin(service, options), { prefix: '/management/v1' })`.
 * It translates requests into `ManagementService` calls, which do all authorization; responses
 * never contain secret values.
 */
export function createManagementPlugin(service: ManagementService, options: ManagementPluginOptions) {
  const adminPermission = options.platformAdminPermission ?? 'platform.admin';

  return async function managementPlugin(app: FastifyInstance): Promise<void> {
    await Promise.resolve();
    // Management responses are never cached (they are tenant- and role-specific).
    app.addHook('onSend', (_request, reply, payload, done) => {
      void reply.header('cache-control', 'no-store');
      done(null, payload);
    });

    const handle = (handler: Handler, status = 200) => async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const identity = await options.authentication.authenticate(request);
        if (!identity) throw new ManagementError(401, 'AUTHENTICATION_REQUIRED', 'Authentication required.');
        const tenantId = identity.attributes?.['tenantId'];
        const actor: Actor = { subject: identity.subject, platformAdmin: identity.permissions.includes(adminPermission), ...(typeof tenantId === 'string' ? { tenantId } : {}) };
        const result = await handler(actor, request);
        return await reply.status(status).send(result ?? { ok: true });
      } catch (error) {
        if (error instanceof ManagementError) return reply.status(error.status).send({ error: { code: error.code, message: error.message } });
        request.log.error({ err: error }, 'management request failed');
        return reply.status(500).send({ error: { code: 'INTERNAL_ERROR', message: 'Internal error.' } });
      }
    };

    const name = z.string().min(1).max(200);
    app.get('/me', handle((actor) => service.me(actor)));

    app.get('/tenants', handle((actor) => service.listTenants(actor)));
    app.post('/tenants', handle((actor, request) => service.createTenant(actor, body(z.object({ id: name, name, owner: name }), request)), 201));
    app.post('/tenants/:tenantId/status', handle((actor, request) => service.setTenantStatus(actor, params(request)['tenantId'] ?? '', body(z.object({ status: z.enum(['active', 'suspended', 'archived']) }), request).status)));
    app.get('/tenant', handle((actor) => service.getTenant(actor)));
    app.patch('/tenant', handle((actor, request) => service.updateTenant(actor, body(z.object({ name: name.optional() }), request))));

    app.get('/memberships', handle((actor) => service.listMemberships(actor)));
    app.put('/memberships/:subject', handle((actor, request) => service.upsertMembership(actor, { subject: params(request)['subject'] ?? '', ...body(z.object({ role: z.enum(['owner', 'admin', 'operator', 'viewer']), projectIds: z.array(name).optional() }), request) })));
    app.delete('/memberships/:subject', handle((actor, request) => service.removeMembership(actor, params(request)['subject'] ?? '')));

    app.get('/projects', handle((actor, request) => service.listProjects(actor, query(request)['includeArchived'] === 'true')));
    app.post('/projects', handle((actor, request) => service.createProject(actor, body(z.object({ name, slug: name, description: z.string().max(2000).optional() }), request)), 201));
    app.patch('/projects/:projectId', handle((actor, request) => service.updateProject(actor, params(request)['projectId'] ?? '', body(z.object({ name: name.optional(), description: z.string().max(2000).optional() }), request))));
    app.post('/projects/:projectId/archive', handle((actor, request) => service.archiveProject(actor, params(request)['projectId'] ?? '')));
    app.get('/projects/:projectId/environments', handle((actor, request) => service.listEnvironments(actor, params(request)['projectId'] ?? '')));
    app.post('/projects/:projectId/environments', handle((actor, request) => service.createEnvironment(actor, params(request)['projectId'] ?? '', body(z.object({ name, production: z.boolean().optional() }), request)), 201));

    app.get('/resources', handle((actor, request) => {
      const q = query(request);
      return service.listResources(actor, { kind: kindParam(q['kind']), projectId: q['projectId'], environment: q['environment'] });
    }));
    app.post('/resources', handle((actor, request) => {
      const input = body(z.object({ kind: z.string(), name, spec: z.unknown(), projectId: name.optional(), environment: name.optional(), enabled: z.boolean().optional() }), request);
      return service.createResource(actor, { ...input, kind: kindParam(input.kind) ?? 'model' });
    }, 201));
    app.get('/resources/:id', handle((actor, request) => service.getResource(actor, params(request)['id'] ?? '')));
    app.post('/resources/:id/versions', handle((actor, request) => service.updateResource(actor, params(request)['id'] ?? '', body(z.object({ spec: z.unknown() }), request).spec), 201));
    app.post('/resources/:id/rollback', handle((actor, request) => service.rollbackResource(actor, params(request)['id'] ?? '', body(z.object({ version: z.number().int().positive() }), request).version)));
    app.post('/resources/:id/enabled', handle((actor, request) => service.setResourceEnabled(actor, params(request)['id'] ?? '', body(z.object({ enabled: z.boolean() }), request).enabled)));
    app.post('/resources/:id/versions/:version/promote', handle((actor, request) => service.promoteVersion(actor, params(request)['id'] ?? '', version(params(request)['version']), body(z.object({ stage: z.enum(['draft', 'staging', 'production']) }), request).stage)));

    app.get('/secrets', handle((actor) => service.listSecrets(actor)));
    app.put('/secrets/:name', handle((actor, request) => service.putSecret(actor, params(request)['name'] ?? '', body(z.object({ value: z.string().min(1).max(16_384) }), request).value)));
    app.delete('/secrets/:name', handle((actor, request) => service.deleteSecret(actor, params(request)['name'] ?? '')));

    app.get('/agents', handle((actor) => service.listAgents(actor)));
    app.get('/tools', handle((actor) => service.listTools(actor)));
    app.post('/openapi/import', handle((actor, request) => service.importOpenApi(actor, body(z.object({ integrationId: name, document: z.record(z.string(), z.unknown()), projectId: name.optional(), environment: name.optional() }), request)), 201));
    app.get('/mcp/:serverId/status', handle((actor, request) => service.mcpStatus(actor, params(request)['serverId'] ?? '')));
    app.post('/knowledge/:id/reindex', handle((actor, request) => service.reindexKnowledge(actor, params(request)['id'] ?? ''), 202));
    app.get('/jobs/:jobId', handle((actor, request) => service.jobStatus(actor, params(request)['jobId'] ?? '')));

    app.get('/conversations', handle((actor, request) => service.listConversations(actor, { limit: Number(query(request)['limit'] ?? 50), cursor: query(request)['cursor'] })));
    app.get('/conversations/:threadId/runs', handle((actor, request) => service.listConversationRuns(actor, params(request)['threadId'] ?? '')));
    app.get('/conversations/:threadId/messages', handle((actor, request) => service.conversationMessages(actor, params(request)['threadId'] ?? '')));

    app.get('/evals', handle((actor, request) => service.listEvalRuns(actor, query(request)['datasetId'])));
    app.get('/evals/:runId', handle((actor, request) => service.getEvalRun(actor, params(request)['runId'] ?? '')));
    app.get('/evals/compare/:baselineId/:candidateId', handle((actor, request) => service.compareEvalRuns(actor, params(request)['baselineId'] ?? '', params(request)['candidateId'] ?? '')));
    app.post('/evals', handle((actor, request) => service.startEval(actor, body(z.object({ datasetId: name, requestId: name }), request)), 202));

    app.get('/traces', handle((actor) => service.listTraces(actor)));
    app.get('/traces/:runId', handle((actor, request) => service.getTrace(actor, params(request)['runId'] ?? '')));
    app.get('/audit', handle((actor, request) => {
      const q = query(request);
      return service.searchAudit(actor, { actor: q['actor'], action: q['action'], decision: q['decision'], runId: q['runId'], from: q['from'], to: q['to'], cursor: q['cursor'], limit: q['limit'] ? Number(q['limit']) : undefined });
    }));
    app.get('/usage', handle((actor, request) => {
      const q = query(request);
      const dimensions = (q['groupBy'] ?? '').split(',').filter(Boolean);
      const allowed = ['kind', 'model', 'provider', 'project', 'environment', 'agent', 'tool', 'subject', 'day', 'month'];
      if (dimensions.some((dimension) => !allowed.includes(dimension))) throw new ManagementError(400, 'VALIDATION_ERROR', 'Unknown usage dimension.');
      return service.usage(actor, { from: q['from'], to: q['to'], projectId: q['projectId'], environment: q['environment'], groupBy: dimensions as never });
    }));
    app.get('/security', handle((actor) => service.securityOverview(actor)));
  };
}
