import { createHash, randomUUID } from 'node:crypto';
import type { DevToolsRecorder } from '@gixcopilot/devtools';
import { compareEvalRuns } from '@gixcopilot/evals';
import type { EvalStore } from '@gixcopilot/evals';
import { discoverOperations, inspectOpenAPI, operationKey, resolveLocalRefs } from '@gixcopilot/openapi';
import type { AuditRecord, AuditSink } from '@gixcopilot/security';
import { DEFAULT_ENVIRONMENTS, roleAtLeast } from '@gixcopilot/tenancy';
import type { ConversationStore, Environment, Membership, Page, Project, RuntimeScope, StoredMessage, StoredRun, Tenant, TenantRole, TenantStatus, ThreadRecord } from '@gixcopilot/tenancy';
import type { UsageDimension, UsageKind, UsageRow, UsageStore } from '@gixcopilot/usage';
import { RESOURCE_KINDS, isAtLeastAsStrict, parseSpec } from './resources.js';
import type { Resource, ResourceKind, ResourceSpec, ResourceVersion, VersionStage } from './resources.js';
import type { SecretStore } from './secrets.js';
import type { ControlPlaneStore } from './store.js';

/** The authenticated caller. `tenantId` comes from the authentication adapter only. */
export interface Actor {
  readonly subject: string;
  readonly tenantId?: string;
  /** Platform operators manage tenants; they get no tenant data without a membership. */
  readonly platformAdmin: boolean;
}

export class ManagementError extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 404 | 409 | 422 | 503,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ManagementError';
  }
}

/** What the running application registered in code, for inspection (never executed here). */
export interface RuntimeCatalog {
  readonly agents?: () => readonly { readonly id: string; readonly version?: string; readonly description?: string; readonly tools?: readonly string[]; readonly model?: { readonly provider: string; readonly model: string } }[];
  readonly tools?: () => readonly { readonly name: string; readonly description: string; readonly source?: string; readonly risk?: string; readonly approval?: string; readonly inputSchema?: unknown }[];
}

/** Structurally compatible with `@gixcopilot/jobs`' `createJobQueue`. */
export interface JobQueuePort {
  enqueue(kind: string, payload: unknown, options: { readonly idempotencyKey: string; readonly tenantId?: string }): Promise<{ readonly jobId: string; readonly duplicate: boolean }>;
  status(jobId: string): Promise<string>;
}

export interface AuditReaderPort {
  forTenant(scope: RuntimeScope): { search(query?: Record<string, unknown>): Promise<Page<AuditRecord>> };
}

export interface CreateManagementServiceOptions {
  readonly store: ControlPlaneStore;
  readonly audit: AuditSink;
  readonly auditReader?: AuditReaderPort;
  readonly secrets?: SecretStore;
  readonly conversations?: ConversationStore;
  readonly usage?: UsageStore;
  readonly evals?: (tenantId: string) => EvalStore;
  readonly traces?: DevToolsRecorder;
  readonly jobs?: JobQueuePort;
  readonly catalog?: RuntimeCatalog;
  readonly mcpStatus?: (tenantId: string, serverId: string) => Promise<{ readonly connected: boolean; readonly tools?: readonly string[]; readonly error?: string }>;
  readonly now?: () => Date;
}

export interface ConfigSnapshot {
  readonly id: string;
  readonly tenantId: string;
  readonly projectId?: string;
  readonly environment?: string;
  readonly resolvedAt: string;
  readonly resources: readonly { readonly kind: ResourceKind; readonly name: string; readonly version: number; readonly spec: unknown }[];
}

const SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/;

/**
 * The management domain layer (Section 168): every platform operation is an authorized,
 * audited method here; the HTTP plugin only translates requests. Nothing here executes tools,
 * compiles code or returns a secret value.
 */
export function createManagementService(options: CreateManagementServiceOptions) {
  const now = options.now ?? (() => new Date());

  async function roleOf(actor: Actor, tenantId: string): Promise<{ role: TenantRole; membership: Membership } | undefined> {
    const membership = await options.store.forTenant(tenantId).getMembership(actor.subject);
    return membership ? { role: membership.role, membership } : undefined;
  }

  /** Resolves the actor's tenant and requires at least `required`. */
  async function authorize(actor: Actor, required: TenantRole, projectId?: string): Promise<{ tenantId: string; role: TenantRole }> {
    if (!actor.tenantId) throw new ManagementError(401, 'AUTHENTICATION_REQUIRED', 'An authenticated tenant is required.');
    const found = await roleOf(actor, actor.tenantId);
    if (!found || !roleAtLeast(found.role, required)) throw new ManagementError(403, 'PERMISSION_DENIED', `This action requires the ${required} role.`);
    const allowed = found.membership.projectIds;
    if (projectId && allowed && !allowed.includes(projectId)) throw new ManagementError(403, 'PERMISSION_DENIED', 'No access to this project.');
    return { tenantId: actor.tenantId, role: found.role };
  }

  function requirePlatformAdmin(actor: Actor): void {
    if (!actor.platformAdmin) throw new ManagementError(403, 'PERMISSION_DENIED', 'Platform administrator required.');
  }

  async function audit(actor: Actor, tenantId: string | undefined, action: string, metadata: Record<string, unknown> = {}, decision = 'allowed'): Promise<void> {
    await options.audit.write({
      id: randomUUID(),
      timestamp: now().toISOString(),
      ...(tenantId ? { tenantId } : {}),
      actor: { kind: 'user', subject: actor.subject },
      action: `management.${action}`,
      decision,
      resultStatus: 'success',
      metadata,
    });
  }

  async function need<T>(value: Promise<T | null> | T | null, what: string): Promise<T> {
    const resolved = await value;
    if (resolved === null || resolved === undefined) throw new ManagementError(404, 'NOT_FOUND', `${what} not found.`);
    return resolved;
  }

  function validate<K extends ResourceKind>(kind: K, spec: unknown): ResourceSpec<K> {
    try {
      return parseSpec(kind, spec);
    } catch (error) {
      const issues = (error as { issues?: { path: (string | number)[]; message: string }[] }).issues ?? [];
      throw new ManagementError(422, 'VALIDATION_ERROR', `Invalid ${kind} spec: ${issues.map((issue) => `${issue.path.join('.') || '(root)'} ${issue.message}`).join('; ') || 'invalid'}`);
    }
  }

  /** Security-relevant rules no platform edit may break (Section 99, 163). */
  async function checkSpecSafety(tenantId: string, kind: ResourceKind, spec: unknown): Promise<void> {
    if (kind === 'tool') {
      const tool = spec as ResourceSpec<'tool'>;
      const declared = options.catalog?.tools?.().find((candidate) => candidate.name === tool.tool);
      if (!declared) throw new ManagementError(422, 'UNKNOWN_TOOL', `Tool "${tool.tool}" is not registered by the application.`);
      if (tool.approval && !isAtLeastAsStrict(tool.approval, declared.approval)) {
        throw new ManagementError(422, 'SECURITY_WEAKENING', `The platform cannot lower "${tool.tool}" approval below "${declared.approval ?? 'none'}" declared in code.`);
      }
    }
    if (kind === 'agent') {
      const agent = spec as ResourceSpec<'agent'>;
      const declared = options.catalog?.agents?.().find((candidate) => candidate.id === agent.agentId);
      if (!declared) throw new ManagementError(422, 'UNKNOWN_AGENT', `Agent "${agent.agentId}" is not defined by the application (no dynamic code).`);
      const extra = (agent.tools ?? []).filter((tool) => !(declared.tools ?? []).includes(tool));
      if (extra.length > 0) throw new ManagementError(422, 'SECURITY_WEAKENING', `Agent tools can only be narrowed; not declared in code: ${extra.join(', ')}.`);
    }
    for (const secretName of [(spec as { apiKeySecret?: string }).apiKeySecret, (spec as { credentialSecret?: string }).credentialSecret]) {
      if (!secretName) continue;
      const described = await options.secrets?.describe(tenantId, secretName);
      if (!described?.configured) throw new ManagementError(422, 'SECRET_NOT_FOUND', `Secret "${secretName}" is not configured.`);
    }
  }

  const service = {
    // --- identity -------------------------------------------------------------------------
    async me(actor: Actor): Promise<{ readonly subject: string; readonly tenantId?: string; readonly role?: TenantRole; readonly platformAdmin: boolean }> {
      const found = actor.tenantId ? await roleOf(actor, actor.tenantId) : undefined;
      return { subject: actor.subject, ...(actor.tenantId ? { tenantId: actor.tenantId } : {}), ...(found ? { role: found.role } : {}), platformAdmin: actor.platformAdmin };
    },

    // --- tenants (Section 102) ------------------------------------------------------------
    async listTenants(actor: Actor): Promise<readonly Tenant[]> {
      requirePlatformAdmin(actor);
      return options.store.listTenants();
    },
    async createTenant(actor: Actor, input: { readonly id: string; readonly name: string; readonly owner: string }): Promise<Tenant> {
      requirePlatformAdmin(actor);
      if (!SLUG.test(input.id)) throw new ManagementError(422, 'VALIDATION_ERROR', 'Tenant id must be a lowercase slug.');
      const tenant = await options.store.createTenant({ id: input.id, name: input.name });
      await options.store.forTenant(tenant.id).upsertMembership({ subject: input.owner, role: 'owner' });
      await audit(actor, tenant.id, 'tenant.create', { owner: input.owner });
      return tenant;
    },
    async setTenantStatus(actor: Actor, tenantId: string, status: TenantStatus): Promise<Tenant> {
      requirePlatformAdmin(actor);
      const tenant = await need(options.store.setTenantStatus(tenantId, status), 'Tenant');
      await audit(actor, tenantId, 'tenant.status', { status });
      return tenant;
    },
    async getTenant(actor: Actor): Promise<Tenant | null> {
      const { tenantId } = await authorize(actor, 'viewer');
      return options.store.forTenant(tenantId).getTenant();
    },
    async updateTenant(actor: Actor, patch: { readonly name?: string }): Promise<Tenant> {
      const { tenantId } = await authorize(actor, 'owner');
      const tenant = await options.store.forTenant(tenantId).updateTenant(patch);
      await audit(actor, tenantId, 'tenant.update', { fields: Object.keys(patch) });
      return tenant;
    },

    // --- memberships (Section 101) ----------------------------------------------------------
    async listMemberships(actor: Actor): Promise<readonly Membership[]> {
      const { tenantId } = await authorize(actor, 'admin');
      return options.store.forTenant(tenantId).listMemberships();
    },
    async upsertMembership(actor: Actor, input: { readonly subject: string; readonly role: TenantRole; readonly projectIds?: readonly string[] }): Promise<Membership> {
      const { tenantId } = await authorize(actor, 'owner');
      const scoped = options.store.forTenant(tenantId);
      const current = await scoped.getMembership(input.subject);
      if (current?.role === 'owner' && input.role !== 'owner') await ensureAnotherOwner(tenantId, input.subject);
      const membership = await scoped.upsertMembership(input);
      await audit(actor, tenantId, 'membership.upsert', { subject: input.subject, role: input.role });
      return membership;
    },
    async removeMembership(actor: Actor, subject: string): Promise<void> {
      const { tenantId } = await authorize(actor, 'owner');
      const scoped = options.store.forTenant(tenantId);
      if ((await scoped.getMembership(subject))?.role === 'owner') await ensureAnotherOwner(tenantId, subject);
      await need(scoped.removeMembership(subject).then((removed) => (removed ? true : null)), 'Membership');
      await audit(actor, tenantId, 'membership.remove', { subject });
    },

    // --- projects and environments (Section 48, 84) ------------------------------------------
    async listProjects(actor: Actor, includeArchived = false): Promise<readonly Project[]> {
      const { tenantId } = await authorize(actor, 'viewer');
      const membership = await options.store.forTenant(tenantId).getMembership(actor.subject);
      const projects = await options.store.forTenant(tenantId).listProjects({ includeArchived });
      return membership?.projectIds ? projects.filter((project) => membership.projectIds?.includes(project.id)) : projects;
    },
    async createProject(actor: Actor, input: { readonly name: string; readonly slug: string; readonly description?: string }): Promise<{ readonly project: Project; readonly environments: readonly Environment[] }> {
      const { tenantId } = await authorize(actor, 'admin');
      if (!SLUG.test(input.slug)) throw new ManagementError(422, 'VALIDATION_ERROR', 'Project slug must be lowercase letters, digits and dashes.');
      const scoped = options.store.forTenant(tenantId);
      const project = await scoped.createProject(input).catch((error: Error) => {
        throw new ManagementError(409, 'CONFLICT', error.message);
      });
      const environments: Environment[] = [];
      for (const name of DEFAULT_ENVIRONMENTS) environments.push(await scoped.createEnvironment(project.id, { name, production: name === 'production' }));
      await audit(actor, tenantId, 'project.create', { projectId: project.id, slug: project.slug });
      return { project, environments };
    },
    async updateProject(actor: Actor, projectId: string, patch: { readonly name?: string; readonly description?: string }): Promise<Project> {
      const { tenantId } = await authorize(actor, 'admin', projectId);
      const project = await need(options.store.forTenant(tenantId).updateProject(projectId, patch), 'Project');
      await audit(actor, tenantId, 'project.update', { projectId });
      return project;
    },
    async archiveProject(actor: Actor, projectId: string): Promise<Project> {
      const { tenantId } = await authorize(actor, 'admin', projectId);
      const project = await need(options.store.forTenant(tenantId).archiveProject(projectId), 'Project');
      await audit(actor, tenantId, 'project.archive', { projectId });
      return project;
    },
    async listEnvironments(actor: Actor, projectId: string): Promise<readonly Environment[]> {
      const { tenantId } = await authorize(actor, 'viewer', projectId);
      await need(options.store.forTenant(tenantId).getProject(projectId), 'Project');
      return options.store.forTenant(tenantId).listEnvironments(projectId);
    },
    async createEnvironment(actor: Actor, projectId: string, input: { readonly name: string; readonly production?: boolean }): Promise<Environment> {
      const { tenantId } = await authorize(actor, 'admin', projectId);
      if (!SLUG.test(input.name)) throw new ManagementError(422, 'VALIDATION_ERROR', 'Environment name must be a lowercase slug.');
      await need(options.store.forTenant(tenantId).getProject(projectId), 'Project');
      const environment = await options.store
        .forTenant(tenantId)
        .createEnvironment(projectId, { name: input.name, production: input.production ?? false })
        .catch((error: Error) => {
          throw new ManagementError(409, 'CONFLICT', error.message);
        });
      await audit(actor, tenantId, 'environment.create', { projectId, name: input.name });
      return environment;
    },

    // --- versioned resources (models, agents, tools, OpenAPI, MCP, knowledge, prompts, security) -
    async listResources(actor: Actor, filter: { readonly kind?: ResourceKind; readonly projectId?: string; readonly environment?: string } = {}): Promise<readonly Resource[]> {
      if (filter.kind && !RESOURCE_KINDS.includes(filter.kind)) throw new ManagementError(422, 'VALIDATION_ERROR', 'Unknown resource kind.');
      const { tenantId } = await authorize(actor, 'viewer', filter.projectId);
      return options.store.forTenant(tenantId).listResources(filter);
    },
    async getResource(actor: Actor, id: string): Promise<{ readonly resource: Resource; readonly versions: readonly ResourceVersion[] }> {
      const { tenantId } = await authorize(actor, 'viewer');
      const scoped = options.store.forTenant(tenantId);
      const resource = await need(scoped.getResource(id), 'Resource');
      return { resource, versions: await scoped.listVersions(id) };
    },
    async createResource(actor: Actor, input: { readonly kind: ResourceKind; readonly name: string; readonly spec: unknown; readonly projectId?: string; readonly environment?: string; readonly enabled?: boolean }) {
      const { tenantId } = await authorize(actor, 'admin', input.projectId);
      if (!RESOURCE_KINDS.includes(input.kind)) throw new ManagementError(422, 'VALIDATION_ERROR', 'Unknown resource kind.');
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(input.name)) throw new ManagementError(422, 'VALIDATION_ERROR', 'Invalid resource name.');
      if (input.projectId) await need(options.store.forTenant(tenantId).getProject(input.projectId), 'Project');
      const spec = validate(input.kind, input.spec);
      await checkSpecSafety(tenantId, input.kind, spec);
      const created = await options.store
        .forTenant(tenantId)
        .createResource({ ...input, spec, createdBy: actor.subject })
        .catch((error: Error) => {
          throw new ManagementError(409, 'CONFLICT', error.message);
        });
      await audit(actor, tenantId, `${input.kind}.create`, { resourceId: created.resource.id, name: input.name });
      return created;
    },
    async updateResource(actor: Actor, id: string, spec: unknown): Promise<ResourceVersion> {
      const { tenantId } = await authorize(actor, 'admin');
      const scoped = options.store.forTenant(tenantId);
      const resource = await need(scoped.getResource(id), 'Resource');
      const parsed = validate(resource.kind, spec);
      await checkSpecSafety(tenantId, resource.kind, parsed);
      const version = await scoped.addVersion(id, { spec: parsed, createdBy: actor.subject });
      await audit(actor, tenantId, `${resource.kind}.version`, { resourceId: id, version: version.version });
      return version;
    },
    async rollbackResource(actor: Actor, id: string, version: number): Promise<Resource> {
      const { tenantId } = await authorize(actor, 'admin');
      const resource = await need(options.store.forTenant(tenantId).setCurrentVersion(id, version), 'Resource version');
      await audit(actor, tenantId, `${resource.kind}.rollback`, { resourceId: id, version });
      return resource;
    },
    async setResourceEnabled(actor: Actor, id: string, enabled: boolean): Promise<Resource> {
      const { tenantId } = await authorize(actor, 'admin');
      const resource = await need(options.store.forTenant(tenantId).setEnabled(id, enabled), 'Resource');
      await audit(actor, tenantId, `${resource.kind}.${enabled ? 'enable' : 'disable'}`, { resourceId: id });
      return resource;
    },
    /** Prompt promotion (Section 96): draft -> staging -> production, never skipping staging. */
    async promoteVersion(actor: Actor, id: string, version: number, stage: VersionStage): Promise<ResourceVersion> {
      const { tenantId } = await authorize(actor, 'admin');
      const scoped = options.store.forTenant(tenantId);
      const resource = await need(scoped.getResource(id), 'Resource');
      const current = await need(scoped.getVersion(id, version), 'Resource version');
      if (stage === 'production' && current.stage !== 'staging') throw new ManagementError(422, 'INVALID_TRANSITION', 'Only a staging version can be promoted to production.');
      if (stage === 'production') {
        for (const other of await scoped.listVersions(id)) if (other.stage === 'production' && other.version !== version) await scoped.setStage(id, other.version, 'staging');
        await scoped.setCurrentVersion(id, version);
      }
      const updated = await need(scoped.setStage(id, version, stage), 'Resource version');
      await audit(actor, tenantId, `${resource.kind}.promote`, { resourceId: id, version, stage });
      return updated;
    },

    // --- secrets (Section 86) ----------------------------------------------------------------
    async putSecret(actor: Actor, name: string, value: string): Promise<{ readonly name: string; readonly configured: true }> {
      const { tenantId } = await authorize(actor, 'admin');
      if (!options.secrets) throw new ManagementError(503, 'NOT_CONFIGURED', 'No secret store is configured.');
      try {
        await options.secrets.put(tenantId, name, value);
      } catch (error) {
        throw new ManagementError(422, 'VALIDATION_ERROR', (error as Error).message);
      }
      await audit(actor, tenantId, 'secret.put', { name });
      return { name, configured: true };
    },
    async listSecrets(actor: Actor): Promise<readonly { readonly name: string; readonly updatedAt: string }[]> {
      const { tenantId } = await authorize(actor, 'admin');
      return (await options.secrets?.list(tenantId)) ?? [];
    },
    async deleteSecret(actor: Actor, name: string): Promise<void> {
      const { tenantId } = await authorize(actor, 'admin');
      await need(options.secrets?.delete(tenantId, name).then((removed) => (removed ? true : null)) ?? null, 'Secret');
      await audit(actor, tenantId, 'secret.delete', { name });
    },

    // --- runtime catalog: agents and tools (Section 87, 89) -----------------------------------
    async listAgents(actor: Actor) {
      const { tenantId } = await authorize(actor, 'viewer');
      const overrides = await options.store.forTenant(tenantId).listResources({ kind: 'agent' });
      return Promise.all((options.catalog?.agents?.() ?? []).map(async (agent) => ({ ...agent, overrides: await withSpecs(tenantId, overrides.filter((resource) => resource.name === agent.id)) })));
    },
    async listTools(actor: Actor) {
      const { tenantId } = await authorize(actor, 'viewer');
      const overrides = await options.store.forTenant(tenantId).listResources({ kind: 'tool' });
      return Promise.all((options.catalog?.tools?.() ?? []).map(async (tool) => ({ ...tool, overrides: await withSpecs(tenantId, overrides.filter((resource) => resource.name === tool.name)) })));
    },

    // --- OpenAPI (Section 90): imported operations start DISABLED -----------------------------
    async importOpenApi(actor: Actor, input: { readonly integrationId: string; readonly document: unknown; readonly projectId?: string; readonly environment?: string }) {
      const { tenantId } = await authorize(actor, 'admin', input.projectId);
      // Inspection lists every operation so an admin can choose; generation itself stays an
      // allowlist, and every operation is stored DISABLED until an admin enables it.
      let keys: string[] = [];
      try {
        keys = discoverOperations(resolveLocalRefs(input.document as never) as never).map((candidate) => operationKey(candidate));
      } catch {
        keys = [];
      }
      const inspected = await inspectOpenAPI({ integrationId: input.integrationId, source: { kind: 'object', document: input.document as never }, include: keys, operations: Object.fromEntries(keys.map((key) => [key, { expose: true }])) });
      if (inspected.report.documentIssues.length > 0) {
        throw new ManagementError(422, 'INVALID_DOCUMENT', inspected.report.documentIssues.map((issue) => `${issue.path}: ${issue.problem}`).join('; '));
      }
      const scoped = options.store.forTenant(tenantId);
      const existing = await scoped.findResource('openapi', input.integrationId, input.projectId, input.environment);
      const previous = existing ? ((await scoped.getVersion(existing.id, existing.currentVersion))?.spec as ResourceSpec<'openapi'> | undefined) : undefined;
      const operations = inspected.tools.map((tool) => {
        const source = tool.metadata?.custom as { method?: string; path?: string } | undefined;
        const before = previous?.operations.find((operation) => operation.toolName === tool.name);
        return {
          toolName: tool.name,
          method: String(source?.method ?? ''),
          path: String(source?.path ?? ''),
          description: tool.description.slice(0, 2000),
          // Never auto-exposed: new operations are disabled; a refresh keeps prior decisions.
          enabled: before?.enabled ?? false,
          ...(before?.approval ? { approval: before.approval } : {}),
        };
      });
      const spec = validate('openapi', { integrationId: input.integrationId, documentHash: createHash('sha256').update(JSON.stringify(input.document)).digest('hex'), operations });
      const result = existing
        ? { resource: existing, version: await scoped.addVersion(existing.id, { spec, createdBy: actor.subject }) }
        : await scoped.createResource({ kind: 'openapi', name: input.integrationId, projectId: input.projectId, environment: input.environment, spec, createdBy: actor.subject });
      await audit(actor, tenantId, existing ? 'openapi.refresh' : 'openapi.import', { integrationId: input.integrationId, operations: operations.length });
      return { ...result, report: inspected.report };
    },

    // --- MCP (Section 91) ------------------------------------------------------------------
    async mcpStatus(actor: Actor, serverId: string) {
      const { tenantId } = await authorize(actor, 'viewer');
      await need(options.store.forTenant(tenantId).findResource('mcp', serverId), 'MCP server');
      return options.mcpStatus ? options.mcpStatus(tenantId, serverId) : { connected: false, error: 'status probe not configured' };
    },

    // --- knowledge (Section 92-93) -----------------------------------------------------------
    async reindexKnowledge(actor: Actor, resourceId: string) {
      const { tenantId } = await authorize(actor, 'operator');
      const resource = await need(options.store.forTenant(tenantId).getResource(resourceId), 'Knowledge source');
      if (resource.kind !== 'knowledge-source') throw new ManagementError(422, 'VALIDATION_ERROR', 'Not a knowledge source.');
      if (!options.jobs) throw new ManagementError(503, 'NOT_CONFIGURED', 'No job queue is configured.');
      const job = await options.jobs.enqueue('knowledge.index', { tenantId, resourceId, version: resource.currentVersion }, { idempotencyKey: `${tenantId}:${resourceId}:${resource.currentVersion}`, tenantId });
      await audit(actor, tenantId, 'knowledge.reindex', { resourceId, jobId: job.jobId });
      return job;
    },
    async jobStatus(actor: Actor, jobId: string) {
      await authorize(actor, 'operator');
      if (!options.jobs) throw new ManagementError(503, 'NOT_CONFIGURED', 'No job queue is configured.');
      return { jobId, status: await options.jobs.status(jobId) };
    },

    // --- conversations (Section 94) ------------------------------------------------------------
    async listConversations(actor: Actor, query: { readonly limit?: number; readonly cursor?: string } = {}): Promise<Page<ThreadRecord>> {
      const { tenantId } = await authorize(actor, 'operator');
      if (!options.conversations) return { items: [] };
      return options.conversations.forTenant({ tenantId }).listThreads(query);
    },
    async listConversationRuns(actor: Actor, threadId: string): Promise<Page<StoredRun>> {
      const { tenantId } = await authorize(actor, 'operator');
      if (!options.conversations) return { items: [] };
      return options.conversations.forTenant({ tenantId }).listRuns({ threadId });
    },
    async conversationMessages(actor: Actor, threadId: string): Promise<Page<StoredMessage>> {
      const { tenantId } = await authorize(actor, 'operator');
      const policy = await securityPolicy(tenantId);
      if (policy.conversationContentAccess !== 'operators') {
        await audit(actor, tenantId, 'conversation.content', { threadId }, 'denied');
        throw new ManagementError(403, 'PERMISSION_DENIED', 'Conversation content access is disabled by the tenant security policy.');
      }
      await audit(actor, tenantId, 'conversation.content', { threadId });
      if (!options.conversations) return { items: [] };
      return options.conversations.forTenant({ tenantId }).listMessages(threadId);
    },

    // --- evaluations (Section 97) --------------------------------------------------------------
    async listEvalRuns(actor: Actor, datasetId?: string) {
      const { tenantId } = await authorize(actor, 'viewer');
      const runs = (await options.evals?.(tenantId).list(datasetId)) ?? [];
      return runs.map((run) => ({ id: run.id, dataset: run.dataset, startedAt: run.startedAt, summary: run.summary }));
    },
    async getEvalRun(actor: Actor, runId: string) {
      const { tenantId } = await authorize(actor, 'viewer');
      return need((await options.evals?.(tenantId).get(runId)) ?? null, 'Eval run');
    },
    async compareEvalRuns(actor: Actor, baselineId: string, candidateId: string) {
      const { tenantId } = await authorize(actor, 'viewer');
      const store = options.evals?.(tenantId);
      const baseline = await need((await store?.get(baselineId)) ?? null, 'Baseline eval run');
      const candidate = await need((await store?.get(candidateId)) ?? null, 'Candidate eval run');
      return compareEvalRuns(baseline, candidate);
    },
    async startEval(actor: Actor, input: { readonly datasetId: string; readonly requestId: string }) {
      const { tenantId } = await authorize(actor, 'operator');
      if (!options.jobs) throw new ManagementError(503, 'NOT_CONFIGURED', 'No job queue is configured.');
      const job = await options.jobs.enqueue('eval.run', { tenantId, datasetId: input.datasetId }, { idempotencyKey: `${tenantId}:${input.datasetId}:${input.requestId}`, tenantId });
      await audit(actor, tenantId, 'eval.start', { datasetId: input.datasetId, jobId: job.jobId });
      return job;
    },

    // --- traces (Section 98): the Phase 11 projection, tenant-scoped ------------------------------
    async listTraces(actor: Actor) {
      const { tenantId } = await authorize(actor, 'operator');
      const session = options.traces?.getSession({ tenantId });
      return (session?.runs ?? []).map((run) => ({ runId: run.runId, kind: run.kind, status: run.status, startedAt: run.startedAt, latencyMs: run.latencyMs, usage: run.usage, errorCount: run.errorCount }));
    },
    async getTrace(actor: Actor, runId: string) {
      const { tenantId } = await authorize(actor, 'operator');
      return need(options.traces?.getRun(runId, { tenantId }) ?? null, 'Trace');
    },

    // --- audit (Section 100): read-only search ---------------------------------------------------
    async searchAudit(actor: Actor, query: Record<string, unknown> = {}): Promise<Page<AuditRecord>> {
      const { tenantId } = await authorize(actor, 'operator');
      if (!options.auditReader) return { items: [] };
      return options.auditReader.forTenant({ tenantId }).search(query);
    },

    // --- usage and cost (Section 103-104) ---------------------------------------------------------
    async usage(actor: Actor, query: { readonly from?: string; readonly to?: string; readonly groupBy?: readonly UsageDimension[]; readonly kinds?: readonly UsageKind[]; readonly projectId?: string; readonly environment?: string } = {}) {
      const { tenantId } = await authorize(actor, 'viewer', query.projectId);
      const rows: readonly UsageRow[] = options.usage
        ? await options.usage.forTenant({ tenantId, ...(query.projectId ? { projectId: query.projectId } : {}), ...(query.environment ? { environment: query.environment } : {}) }).aggregate(query)
        : [];
      return { rows, costLabel: 'Estimated cost (from configured pricing; not an invoice)' };
    },

    // --- security overview (Section 99) -------------------------------------------------------------
    async securityOverview(actor: Actor) {
      const { tenantId } = await authorize(actor, 'viewer');
      const scoped = options.store.forTenant(tenantId);
      const [policies, budgets, rateLimits] = await Promise.all([
        scoped.listResources({ kind: 'security-policy' }),
        scoped.listResources({ kind: 'budget' }),
        scoped.listResources({ kind: 'rate-limit' }),
      ]);
      return {
        policy: await securityPolicy(tenantId),
        budgets,
        rateLimits,
        tools: (options.catalog?.tools?.() ?? []).map((tool) => ({ name: tool.name, risk: tool.risk, approval: tool.approval })),
        policies,
      };
    },

    // --- config snapshots (Section 171-172) ----------------------------------------------------------
    /** The resolved, versioned configuration a run should use. Callable by the data plane with a
     * service identity; never mutated by later edits (a new edit yields a new snapshot id). */
    async snapshot(scope: RuntimeScope): Promise<ConfigSnapshot> {
      const scoped = options.store.forTenant(scope.tenantId);
      const all = await scoped.listResources();
      const applicable = all.filter(
        (resource) =>
          resource.enabled &&
          (resource.projectId === undefined || resource.projectId === scope.projectId) &&
          (resource.environment === undefined || resource.environment === scope.environment),
      );
      const resources = [];
      for (const resource of applicable) {
        const version = await scoped.getVersion(resource.id, resource.currentVersion);
        if (version) resources.push({ kind: resource.kind, name: resource.name, version: version.version, spec: version.spec });
      }
      resources.sort((a, b) => `${a.kind}/${a.name}`.localeCompare(`${b.kind}/${b.name}`));
      const id = createHash('sha256').update(JSON.stringify(resources)).digest('hex').slice(0, 16);
      return { id, tenantId: scope.tenantId, ...(scope.projectId ? { projectId: scope.projectId } : {}), ...(scope.environment ? { environment: scope.environment } : {}), resolvedAt: now().toISOString(), resources };
    },
  };

  async function withSpecs(tenantId: string, resources: readonly Resource[]) {
    const scoped = options.store.forTenant(tenantId);
    return Promise.all(resources.map(async (resource) => ({ ...resource, spec: (await scoped.getVersion(resource.id, resource.currentVersion))?.spec })));
  }

  async function ensureAnotherOwner(tenantId: string, leaving: string): Promise<void> {
    const owners = (await options.store.forTenant(tenantId).listMemberships()).filter((membership) => membership.role === 'owner' && membership.subject !== leaving);
    if (owners.length === 0) throw new ManagementError(409, 'LAST_OWNER', 'A tenant must keep at least one owner.');
  }

  async function securityPolicy(tenantId: string): Promise<ResourceSpec<'security-policy'>> {
    const scoped = options.store.forTenant(tenantId);
    const resource = (await scoped.listResources({ kind: 'security-policy' })).find((candidate) => candidate.enabled && candidate.projectId === undefined);
    const version = resource ? await scoped.getVersion(resource.id, resource.currentVersion) : null;
    return parseSpec('security-policy', version?.spec ?? {});
  }

  return service;
}

export type ManagementService = ReturnType<typeof createManagementService>;
