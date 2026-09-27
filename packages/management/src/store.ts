import { randomUUID } from 'node:crypto';
import type { Environment, Membership, Project, Tenant, TenantStatus } from '@gixcopilot/tenancy';
import type { Resource, ResourceKind, ResourceVersion, VersionStage } from './resources.js';

export interface ResourceFilter {
  readonly kind?: ResourceKind;
  readonly projectId?: string;
  readonly environment?: string;
}

export interface CreateResourceInput {
  readonly kind: ResourceKind;
  readonly name: string;
  readonly projectId?: string;
  readonly environment?: string;
  readonly spec: unknown;
  readonly createdBy: string;
  readonly stage?: VersionStage;
  readonly enabled?: boolean;
}

/** One tenant's control-plane data. Reachable only through `ControlPlaneStore.forTenant`. */
export interface ScopedControlPlane {
  readonly tenantId: string;
  getTenant(): Promise<Tenant | null>;
  updateTenant(patch: { readonly name?: string; readonly metadata?: Readonly<Record<string, string>> }): Promise<Tenant>;

  listProjects(options?: { readonly includeArchived?: boolean }): Promise<readonly Project[]>;
  getProject(id: string): Promise<Project | null>;
  createProject(input: { readonly name: string; readonly slug: string; readonly description?: string }): Promise<Project>;
  updateProject(id: string, patch: { readonly name?: string; readonly description?: string }): Promise<Project | null>;
  /** Archival instead of deletion (Section 84). */
  archiveProject(id: string): Promise<Project | null>;

  listEnvironments(projectId: string): Promise<readonly Environment[]>;
  createEnvironment(projectId: string, input: { readonly name: string; readonly production: boolean }): Promise<Environment>;

  listMemberships(): Promise<readonly Membership[]>;
  getMembership(subject: string): Promise<Membership | null>;
  upsertMembership(membership: Omit<Membership, 'tenantId' | 'createdAt'>): Promise<Membership>;
  removeMembership(subject: string): Promise<boolean>;

  listResources(filter?: ResourceFilter): Promise<readonly Resource[]>;
  getResource(id: string): Promise<Resource | null>;
  findResource(kind: ResourceKind, name: string, projectId?: string, environment?: string): Promise<Resource | null>;
  createResource(input: CreateResourceInput): Promise<{ readonly resource: Resource; readonly version: ResourceVersion }>;
  addVersion(resourceId: string, input: { readonly spec: unknown; readonly createdBy: string; readonly stage?: VersionStage }): Promise<ResourceVersion>;
  listVersions(resourceId: string): Promise<readonly ResourceVersion[]>;
  getVersion(resourceId: string, version: number): Promise<ResourceVersion | null>;
  setCurrentVersion(resourceId: string, version: number): Promise<Resource | null>;
  setEnabled(resourceId: string, enabled: boolean): Promise<Resource | null>;
  setStage(resourceId: string, version: number, stage: VersionStage): Promise<ResourceVersion | null>;
}

export interface ControlPlaneStore {
  forTenant(tenantId: string): ScopedControlPlane;
  /** Platform-administrator operations (never exposed to tenant roles). */
  listTenants(): Promise<readonly Tenant[]>;
  createTenant(input: { readonly id: string; readonly name: string }): Promise<Tenant>;
  setTenantStatus(id: string, status: TenantStatus): Promise<Tenant | null>;
}

/** In-memory `ControlPlaneStore` for development and tests (not durable). */
export function createInMemoryControlPlaneStore(now: () => Date = () => new Date()): ControlPlaneStore {
  const tenants = new Map<string, Tenant>();
  const projects = new Map<string, Project>();
  const environments = new Map<string, Environment>();
  const memberships = new Map<string, Membership>();
  const resources = new Map<string, Resource>();
  const versions = new Map<string, ResourceVersion[]>();
  const stamp = (): string => now().toISOString();

  return {
    async listTenants() {
      return Promise.resolve([...tenants.values()]);
    },
    createTenant(input) {
      if (tenants.has(input.id)) return Promise.reject(new Error(`Tenant ${input.id} exists.`));
      const tenant: Tenant = { id: input.id, name: input.name, status: 'active', createdAt: stamp(), updatedAt: stamp() };
      tenants.set(input.id, tenant);
      return Promise.resolve(tenant);
    },
    setTenantStatus(id, status) {
      const tenant = tenants.get(id);
      if (!tenant) return Promise.resolve(null);
      const next = { ...tenant, status, updatedAt: stamp() };
      tenants.set(id, next);
      return Promise.resolve(next);
    },
    forTenant(tenantId) {
      const own = <T extends { tenantId: string }>(value: T | undefined): T | null => (value && value.tenantId === tenantId ? value : null);
      const resourceOf = (id: string): Resource | null => own(resources.get(id));
      const scoped: ScopedControlPlane = {
        tenantId,
        getTenant: () => Promise.resolve(tenants.get(tenantId) ?? null),
        updateTenant(patch) {
          const existing = tenants.get(tenantId) ?? { id: tenantId, name: tenantId, status: 'active' as const, createdAt: stamp(), updatedAt: stamp() };
          const next: Tenant = { ...existing, ...(patch.name ? { name: patch.name } : {}), ...(patch.metadata ? { metadata: patch.metadata } : {}), updatedAt: stamp() };
          tenants.set(tenantId, next);
          return Promise.resolve(next);
        },
        listProjects(options = {}) {
          return Promise.resolve([...projects.values()].filter((project) => project.tenantId === tenantId && (options.includeArchived || project.status === 'active')));
        },
        getProject: (id) => Promise.resolve(own(projects.get(id))),
        createProject(input) {
          if ([...projects.values()].some((project) => project.tenantId === tenantId && project.slug === input.slug)) {
            return Promise.reject(new Error(`Project slug "${input.slug}" already exists.`));
          }
          const project: Project = { id: randomUUID(), tenantId, name: input.name, slug: input.slug, description: input.description, status: 'active', createdAt: stamp(), updatedAt: stamp() };
          projects.set(project.id, project);
          return Promise.resolve(project);
        },
        updateProject(id, patch) {
          const project = own(projects.get(id));
          if (!project) return Promise.resolve(null);
          const next: Project = { ...project, ...(patch.name ? { name: patch.name } : {}), ...(patch.description !== undefined ? { description: patch.description } : {}), updatedAt: stamp() };
          projects.set(id, next);
          return Promise.resolve(next);
        },
        archiveProject(id) {
          const project = own(projects.get(id));
          if (!project) return Promise.resolve(null);
          const next: Project = { ...project, status: 'archived', updatedAt: stamp() };
          projects.set(id, next);
          return Promise.resolve(next);
        },
        listEnvironments(projectId) {
          return Promise.resolve([...environments.values()].filter((environment) => environment.tenantId === tenantId && environment.projectId === projectId));
        },
        createEnvironment(projectId, input) {
          if (!own(projects.get(projectId))) return Promise.reject(new Error('Unknown project.'));
          if ([...environments.values()].some((environment) => environment.tenantId === tenantId && environment.projectId === projectId && environment.name === input.name)) {
            return Promise.reject(new Error(`Environment "${input.name}" already exists.`));
          }
          const environment: Environment = { id: randomUUID(), tenantId, projectId, name: input.name, production: input.production, createdAt: stamp(), updatedAt: stamp() };
          environments.set(environment.id, environment);
          return Promise.resolve(environment);
        },
        listMemberships: () => Promise.resolve([...memberships.values()].filter((membership) => membership.tenantId === tenantId)),
        getMembership: (subject) => Promise.resolve(memberships.get(`${tenantId}\u0000${subject}`) ?? null),
        upsertMembership(input) {
          const key = `${tenantId}\u0000${input.subject}`;
          const membership: Membership = { ...input, tenantId, createdAt: memberships.get(key)?.createdAt ?? stamp() };
          memberships.set(key, membership);
          return Promise.resolve(membership);
        },
        removeMembership: (subject) => Promise.resolve(memberships.delete(`${tenantId}\u0000${subject}`)),
        listResources(filter = {}) {
          return Promise.resolve(
            [...resources.values()].filter(
              (resource) =>
                resource.tenantId === tenantId &&
                (!filter.kind || resource.kind === filter.kind) &&
                (filter.projectId === undefined || resource.projectId === filter.projectId) &&
                (filter.environment === undefined || resource.environment === filter.environment),
            ),
          );
        },
        getResource: (id) => Promise.resolve(resourceOf(id)),
        findResource(kind, name, projectId, environment) {
          return Promise.resolve(
            [...resources.values()].find(
              (resource) => resource.tenantId === tenantId && resource.kind === kind && resource.name === name && resource.projectId === projectId && resource.environment === environment,
            ) ?? null,
          );
        },
        async createResource(input) {
          if (await scoped.findResource(input.kind, input.name, input.projectId, input.environment)) throw new Error(`${input.kind} "${input.name}" already exists.`);
          const resource: Resource = {
            id: randomUUID(),
            tenantId,
            ...(input.projectId ? { projectId: input.projectId } : {}),
            ...(input.environment ? { environment: input.environment } : {}),
            kind: input.kind,
            name: input.name,
            currentVersion: 1,
            enabled: input.enabled ?? true,
            createdAt: stamp(),
            updatedAt: stamp(),
          };
          const version: ResourceVersion = { resourceId: resource.id, version: 1, spec: structuredClone(input.spec), stage: input.stage ?? 'draft', createdBy: input.createdBy, createdAt: stamp() };
          resources.set(resource.id, resource);
          versions.set(resource.id, [version]);
          return { resource, version };
        },
        addVersion(resourceId, input) {
          const resource = resourceOf(resourceId);
          if (!resource) return Promise.reject(new Error('Unknown resource.'));
          const list = versions.get(resourceId) ?? [];
          const version: ResourceVersion = { resourceId, version: list.length + 1, spec: structuredClone(input.spec), stage: input.stage ?? 'draft', createdBy: input.createdBy, createdAt: stamp() };
          list.push(version);
          versions.set(resourceId, list);
          resources.set(resourceId, { ...resource, currentVersion: version.version, updatedAt: stamp() });
          return Promise.resolve(version);
        },
        listVersions: (resourceId) => Promise.resolve(resourceOf(resourceId) ? [...(versions.get(resourceId) ?? [])] : []),
        getVersion: (resourceId, version) => Promise.resolve(resourceOf(resourceId) ? (versions.get(resourceId)?.find((entry) => entry.version === version) ?? null) : null),
        setCurrentVersion(resourceId, version) {
          const resource = resourceOf(resourceId);
          if (!resource || !versions.get(resourceId)?.some((entry) => entry.version === version)) return Promise.resolve(null);
          const next = { ...resource, currentVersion: version, updatedAt: stamp() };
          resources.set(resourceId, next);
          return Promise.resolve(next);
        },
        setEnabled(resourceId, enabled) {
          const resource = resourceOf(resourceId);
          if (!resource) return Promise.resolve(null);
          const next = { ...resource, enabled, updatedAt: stamp() };
          resources.set(resourceId, next);
          return Promise.resolve(next);
        },
        setStage(resourceId, version, stage) {
          if (!resourceOf(resourceId)) return Promise.resolve(null);
          const list = versions.get(resourceId) ?? [];
          const index = list.findIndex((entry) => entry.version === version);
          const existing = list[index];
          if (!existing) return Promise.resolve(null);
          const next = { ...existing, stage };
          list[index] = next;
          return Promise.resolve(next);
        },
      };
      return scoped;
    },
  };
}
