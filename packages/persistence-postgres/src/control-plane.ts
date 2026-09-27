import { randomUUID } from 'node:crypto';
import { and, asc, eq, isNull } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { ControlPlaneStore, EncryptedSecretRepository, Resource, ResourceKind, ResourceVersion, ScopedControlPlane, VersionStage } from '@gixcopilot/management';
import { assertValidId } from '@gixcopilot/tenancy';
import type { Environment, Membership, Project, Tenant, TenantRole, TenantStatus } from '@gixcopilot/tenancy';
import { environments, memberships, projects, resourceVersions, resources, secrets, tenants } from './schema.js';

const iso = (value: Date): string => value.toISOString();

function toTenant(row: typeof tenants.$inferSelect): Tenant {
  return { id: row.id, name: row.name, status: row.status as TenantStatus, createdAt: iso(row.createdAt), updatedAt: iso(row.updatedAt), ...(row.metadata ? { metadata: row.metadata as Record<string, string> } : {}) };
}
function toProject(row: typeof projects.$inferSelect): Project {
  return { id: row.id, tenantId: row.tenantId, name: row.name, slug: row.slug, status: row.status as Project['status'], createdAt: iso(row.createdAt), updatedAt: iso(row.updatedAt), ...(row.description ? { description: row.description } : {}) };
}
function toEnvironment(row: typeof environments.$inferSelect): Environment {
  return { id: row.id, tenantId: row.tenantId, projectId: row.projectId, name: row.name, production: row.production, createdAt: iso(row.createdAt), updatedAt: iso(row.updatedAt) };
}
function toMembership(row: typeof memberships.$inferSelect): Membership {
  return { tenantId: row.tenantId, subject: row.subject, role: row.role as TenantRole, createdAt: iso(row.createdAt), ...(row.projectIds ? { projectIds: row.projectIds as string[] } : {}) };
}
function toResource(row: typeof resources.$inferSelect): Resource {
  return {
    id: row.id,
    tenantId: row.tenantId,
    kind: row.kind as ResourceKind,
    name: row.name,
    currentVersion: row.currentVersion,
    enabled: row.enabled,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
    ...(row.projectId ? { projectId: row.projectId } : {}),
    ...(row.environment ? { environment: row.environment } : {}),
  };
}
function toVersion(row: typeof resourceVersions.$inferSelect): ResourceVersion {
  return { resourceId: row.resourceId, version: row.version, spec: row.spec, stage: row.stage as VersionStage, createdBy: row.createdBy, createdAt: iso(row.createdAt) };
}

const optional = (column: typeof resources.projectId | typeof resources.environment, value: string | undefined): SQL => (value === undefined ? isNull(column) : eq(column, value));

function pgErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  if ('code' in error && typeof error.code === 'string') return error.code;
  return 'cause' in error ? pgErrorCode(error.cause) : undefined;
}

/**
 * PostgreSQL `ControlPlaneStore`. Like every Phase 12 repository, tenant data is reachable only
 * through `forTenant(tenantId)`, and every statement filters by that tenant. Version creation
 * and "current version" updates happen in one transaction.
 */
export function createPostgresControlPlaneStore(db: NodePgDatabase): ControlPlaneStore {
  return {
    async listTenants() {
      return (await db.select().from(tenants).orderBy(asc(tenants.id))).map(toTenant);
    },
    async createTenant(input) {
      assertValidId(input.id, 'tenant id');
      const [row] = await db.insert(tenants).values({ id: input.id, name: input.name }).returning();
      if (!row) throw new Error('tenant insert returned no row');
      return toTenant(row);
    },
    async setTenantStatus(id, status) {
      const [row] = await db.update(tenants).set({ status, updatedAt: new Date() }).where(eq(tenants.id, id)).returning();
      return row ? toTenant(row) : null;
    },
    forTenant(tenantIdInput) {
      const tenantId = assertValidId(tenantIdInput, 'tenant id');
      const scoped: ScopedControlPlane = {
        tenantId,
        async getTenant() {
          const [row] = await db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
          return row ? toTenant(row) : null;
        },
        async updateTenant(patch) {
          const [row] = await db
            .insert(tenants)
            .values({ id: tenantId, name: patch.name ?? tenantId, metadata: patch.metadata ?? null })
            .onConflictDoUpdate({ target: tenants.id, set: { ...(patch.name ? { name: patch.name } : {}), ...(patch.metadata ? { metadata: patch.metadata } : {}), updatedAt: new Date() } })
            .returning();
          if (!row) throw new Error('tenant update returned no row');
          return toTenant(row);
        },
        async listProjects(options = {}) {
          const rows = await db.select().from(projects).where(and(eq(projects.tenantId, tenantId), ...(options.includeArchived ? [] : [eq(projects.status, 'active')]))).orderBy(asc(projects.slug));
          return rows.map(toProject);
        },
        async getProject(id) {
          const [row] = await db.select().from(projects).where(and(eq(projects.tenantId, tenantId), eq(projects.id, id))).limit(1);
          return row ? toProject(row) : null;
        },
        async createProject(input) {
          try {
            const [row] = await db.insert(projects).values({ tenantId, id: randomUUID(), name: input.name, slug: input.slug, description: input.description ?? null }).returning();
            if (!row) throw new Error('project insert returned no row');
            return toProject(row);
          } catch (error) {
            if (pgErrorCode(error) === '23505') throw new Error(`Project slug "${input.slug}" already exists.`);
            throw error;
          }
        },
        async updateProject(id, patch) {
          const [row] = await db
            .update(projects)
            .set({ ...(patch.name ? { name: patch.name } : {}), ...(patch.description !== undefined ? { description: patch.description } : {}), updatedAt: new Date() })
            .where(and(eq(projects.tenantId, tenantId), eq(projects.id, id)))
            .returning();
          return row ? toProject(row) : null;
        },
        async archiveProject(id) {
          const [row] = await db.update(projects).set({ status: 'archived', updatedAt: new Date() }).where(and(eq(projects.tenantId, tenantId), eq(projects.id, id))).returning();
          return row ? toProject(row) : null;
        },
        async listEnvironments(projectId) {
          return (await db.select().from(environments).where(and(eq(environments.tenantId, tenantId), eq(environments.projectId, projectId))).orderBy(asc(environments.createdAt))).map(toEnvironment);
        },
        async createEnvironment(projectId, input) {
          try {
            const [row] = await db.insert(environments).values({ tenantId, id: randomUUID(), projectId, name: input.name, production: input.production }).returning();
            if (!row) throw new Error('environment insert returned no row');
            return toEnvironment(row);
          } catch (error) {
            const code = pgErrorCode(error);
            if (code === '23505') throw new Error(`Environment "${input.name}" already exists.`);
            if (code === '23503') throw new Error('Unknown project.');
            throw error;
          }
        },
        async listMemberships() {
          return (await db.select().from(memberships).where(eq(memberships.tenantId, tenantId)).orderBy(asc(memberships.subject))).map(toMembership);
        },
        async getMembership(subject) {
          const [row] = await db.select().from(memberships).where(and(eq(memberships.tenantId, tenantId), eq(memberships.subject, subject))).limit(1);
          return row ? toMembership(row) : null;
        },
        async upsertMembership(input) {
          const [row] = await db
            .insert(memberships)
            .values({ tenantId, subject: input.subject, role: input.role, projectIds: input.projectIds ?? null })
            .onConflictDoUpdate({ target: [memberships.tenantId, memberships.subject], set: { role: input.role, projectIds: input.projectIds ?? null } })
            .returning();
          if (!row) throw new Error('membership upsert returned no row');
          return toMembership(row);
        },
        async removeMembership(subject) {
          return (await db.delete(memberships).where(and(eq(memberships.tenantId, tenantId), eq(memberships.subject, subject))).returning()).length > 0;
        },
        async listResources(filter = {}) {
          const rows = await db
            .select()
            .from(resources)
            .where(
              and(
                eq(resources.tenantId, tenantId),
                ...(filter.kind ? [eq(resources.kind, filter.kind)] : []),
                ...(filter.projectId !== undefined ? [eq(resources.projectId, filter.projectId)] : []),
                ...(filter.environment !== undefined ? [eq(resources.environment, filter.environment)] : []),
              ),
            )
            .orderBy(asc(resources.kind), asc(resources.name));
          return rows.map(toResource);
        },
        async getResource(id) {
          const [row] = await db.select().from(resources).where(and(eq(resources.tenantId, tenantId), eq(resources.id, id))).limit(1);
          return row ? toResource(row) : null;
        },
        async findResource(kind, name, projectId, environment) {
          const [row] = await db
            .select()
            .from(resources)
            .where(and(eq(resources.tenantId, tenantId), eq(resources.kind, kind), eq(resources.name, name), optional(resources.projectId, projectId), optional(resources.environment, environment)))
            .limit(1);
          return row ? toResource(row) : null;
        },
        async createResource(input) {
          const id = randomUUID();
          try {
            return await db.transaction(async (tx) => {
              const [resource] = await tx
                .insert(resources)
                .values({ tenantId, id, kind: input.kind, name: input.name, projectId: input.projectId ?? null, environment: input.environment ?? null, currentVersion: 1, enabled: input.enabled ?? true })
                .returning();
              const [version] = await tx.insert(resourceVersions).values({ tenantId, resourceId: id, version: 1, spec: input.spec, stage: input.stage ?? 'draft', createdBy: input.createdBy }).returning();
              if (!resource || !version) throw new Error('resource insert returned no row');
              return { resource: toResource(resource), version: toVersion(version) };
            });
          } catch (error) {
            if (pgErrorCode(error) === '23505') throw new Error(`${input.kind} "${input.name}" already exists.`);
            throw error;
          }
        },
        async addVersion(resourceId, input) {
          return db.transaction(async (tx) => {
            // Lock the resource row so concurrent edits get consecutive version numbers.
            const [resource] = await tx.select().from(resources).where(and(eq(resources.tenantId, tenantId), eq(resources.id, resourceId))).for('update');
            if (!resource) throw new Error('Unknown resource.');
            const [latest] = await tx
              .select({ version: resourceVersions.version })
              .from(resourceVersions)
              .where(and(eq(resourceVersions.tenantId, tenantId), eq(resourceVersions.resourceId, resourceId)))
              .orderBy(asc(resourceVersions.version))
              .then((rows) => rows.slice(-1));
            const next = (latest?.version ?? 0) + 1;
            const [version] = await tx.insert(resourceVersions).values({ tenantId, resourceId, version: next, spec: input.spec, stage: input.stage ?? 'draft', createdBy: input.createdBy }).returning();
            await tx.update(resources).set({ currentVersion: next, updatedAt: new Date() }).where(and(eq(resources.tenantId, tenantId), eq(resources.id, resourceId)));
            if (!version) throw new Error('version insert returned no row');
            return toVersion(version);
          });
        },
        async listVersions(resourceId) {
          return (
            await db
              .select()
              .from(resourceVersions)
              .where(and(eq(resourceVersions.tenantId, tenantId), eq(resourceVersions.resourceId, resourceId)))
              .orderBy(asc(resourceVersions.version))
          ).map(toVersion);
        },
        async getVersion(resourceId, version) {
          const [row] = await db
            .select()
            .from(resourceVersions)
            .where(and(eq(resourceVersions.tenantId, tenantId), eq(resourceVersions.resourceId, resourceId), eq(resourceVersions.version, version)))
            .limit(1);
          return row ? toVersion(row) : null;
        },
        async setCurrentVersion(resourceId, version) {
          if (!(await scoped.getVersion(resourceId, version))) return null;
          const [row] = await db.update(resources).set({ currentVersion: version, updatedAt: new Date() }).where(and(eq(resources.tenantId, tenantId), eq(resources.id, resourceId))).returning();
          return row ? toResource(row) : null;
        },
        async setEnabled(resourceId, enabled) {
          const [row] = await db.update(resources).set({ enabled, updatedAt: new Date() }).where(and(eq(resources.tenantId, tenantId), eq(resources.id, resourceId))).returning();
          return row ? toResource(row) : null;
        },
        async setStage(resourceId, version, stage) {
          const [row] = await db
            .update(resourceVersions)
            .set({ stage })
            .where(and(eq(resourceVersions.tenantId, tenantId), eq(resourceVersions.resourceId, resourceId), eq(resourceVersions.version, version)))
            .returning();
          return row ? toVersion(row) : null;
        },
      };
      return scoped;
    },
  };
}

/** Stores only AES-GCM ciphertext rows for `createEncryptedSecretStore`. */
export function createPostgresSecretRepository(db: NodePgDatabase): EncryptedSecretRepository {
  return {
    async save(row) {
      await db
        .insert(secrets)
        .values({ ...row, updatedAt: new Date(row.updatedAt) })
        .onConflictDoUpdate({ target: [secrets.tenantId, secrets.name], set: { ciphertext: row.ciphertext, iv: row.iv, tag: row.tag, keyVersion: row.keyVersion, updatedAt: new Date(row.updatedAt) } });
    },
    async get(tenantId, name) {
      const [row] = await db.select().from(secrets).where(and(eq(secrets.tenantId, tenantId), eq(secrets.name, name))).limit(1);
      return row ? { ...row, updatedAt: iso(row.updatedAt) } : undefined;
    },
    async list(tenantId) {
      return (await db.select().from(secrets).where(eq(secrets.tenantId, tenantId)).orderBy(asc(secrets.name))).map((row) => ({ ...row, updatedAt: iso(row.updatedAt) }));
    },
    async delete(tenantId, name) {
      return (await db.delete(secrets).where(and(eq(secrets.tenantId, tenantId), eq(secrets.name, name))).returning()).length > 0;
    },
  };
}
