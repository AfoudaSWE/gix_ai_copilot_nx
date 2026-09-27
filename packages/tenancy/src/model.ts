/**
 * The production boundary model: Tenant -> Project -> Environment (Phase 12 Section 48).
 * Example: Acme (tenant) -> Visa Platform (project) -> development / staging / production.
 */
export type TenantStatus = 'active' | 'suspended' | 'archived';
export type ProjectStatus = 'active' | 'archived';

export interface Tenant {
  readonly id: string;
  readonly name: string;
  readonly status: TenantStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly metadata?: Readonly<Record<string, string>>;
}

export interface Project {
  readonly id: string;
  readonly tenantId: string;
  readonly name: string;
  readonly slug: string;
  readonly description?: string;
  readonly status: ProjectStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export const DEFAULT_ENVIRONMENTS = ['development', 'staging', 'production'] as const;

export interface Environment {
  readonly id: string;
  readonly tenantId: string;
  readonly projectId: string;
  /** `development`, `staging`, `production` or a custom name. */
  readonly name: string;
  /** Production environments get stricter defaults in the management API. */
  readonly production: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * Tenant-level roles for the management plane. Identity (passwords, SSO) belongs to the
 * application's identity provider; the platform only stores memberships.
 *
 *  owner    - everything, including memberships and tenant settings
 *  admin    - configure projects, models, agents, tools, integrations, security policies
 *  operator - run evaluations, inspect conversations metadata, traces, audit, usage
 *  viewer   - read-only configuration and usage
 */
export type TenantRole = 'owner' | 'admin' | 'operator' | 'viewer';

export interface Membership {
  readonly tenantId: string;
  readonly subject: string;
  readonly role: TenantRole;
  /** Optional restriction to specific projects; absent means all projects. */
  readonly projectIds?: readonly string[];
  readonly createdAt: string;
}

const ROLE_RANK: Readonly<Record<TenantRole, number>> = { viewer: 0, operator: 1, admin: 2, owner: 3 };

export function roleAtLeast(role: TenantRole, required: TenantRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[required];
}
