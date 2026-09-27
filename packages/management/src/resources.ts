import { z } from 'zod';

/**
 * Versioned control-plane resources (Phase 12 Section 79-99). A resource is a named piece of
 * configuration scoped to a tenant, optionally a project and an environment; every change
 * creates a new immutable version, and runs use a resolved snapshot of current versions
 * (Section 171), so an admin edit never mutates an active run.
 */
export const RESOURCE_KINDS = ['model', 'agent', 'tool', 'openapi', 'mcp', 'knowledge-source', 'prompt', 'security-policy', 'budget', 'rate-limit'] as const;
export type ResourceKind = (typeof RESOURCE_KINDS)[number];

const name = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/);
const secretName = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/);
const approvalLevel = z.enum(['none', 'user-confirmation', 'supervisor', 'admin', 'two-person']);

export const resourceSpecs = {
  model: z
    .object({
      provider: name,
      model: z.string().min(1).max(200),
      /** Name of a write-only secret in the tenant's secret store (never the key itself). */
      apiKeySecret: secretName.optional(),
      baseUrl: z.url().optional(),
      capabilities: z
        .object({ streaming: z.boolean(), tools: z.boolean(), structuredOutput: z.boolean(), vision: z.boolean(), contextWindow: z.number().int().positive() })
        .optional(),
      tier: z.enum(['economy', 'standard', 'premium']).optional(),
      parameters: z.object({ temperature: z.number().min(0).max(2).optional(), maxOutputTokens: z.number().int().positive().optional() }).strict().optional(),
      routing: z.object({ strategy: z.enum(['fixed', 'fallback', 'capability', 'policy']), fallbacks: z.array(z.object({ provider: name, model: z.string().min(1) })).default([]) }).optional(),
    })
    .strict(),
  agent: z
    .object({
      agentId: name,
      model: z.object({ provider: name, model: z.string().min(1) }).optional(),
      /** Only a subset of the tools the agent's code already declares. */
      tools: z.array(z.string().min(1)).optional(),
      knowledge: z.array(z.string().min(1)).optional(),
      limits: z.object({ maxIterations: z.number().int().positive().optional(), maxToolCalls: z.number().int().positive().optional() }).strict().optional(),
      promptRef: z.object({ name, version: z.number().int().positive().optional() }).optional(),
    })
    .strict(),
  tool: z
    .object({
      tool: z.string().min(1),
      /** Overrides may only tighten what code declares (checked against the runtime catalog). */
      approval: approvalLevel.optional(),
      description: z.string().max(2000).optional(),
    })
    .strict(),
  openapi: z
    .object({
      integrationId: name,
      sourceUrl: z.url().optional(),
      documentHash: z.string().optional(),
      operations: z.array(
        z
          .object({
            toolName: z.string().min(1),
            method: z.string(),
            path: z.string(),
            description: z.string().max(2000).optional(),
            enabled: z.boolean(),
            approval: approvalLevel.optional(),
          })
          .strict(),
      ),
    })
    .strict(),
  mcp: z
    .object({
      serverId: name,
      transport: z.enum(['stdio', 'http']),
      command: z.string().optional(),
      args: z.array(z.string()).optional(),
      url: z.url().optional(),
      credentialSecret: secretName.optional(),
      tools: z.array(z.object({ name: z.string().min(1), enabled: z.boolean(), approval: approvalLevel.optional() }).strict()).default([]),
    })
    .strict(),
  'knowledge-source': z
    .object({
      sourceId: name,
      type: z.enum(['file', 'url', 'mcp-resource', 'custom']),
      uri: z.string().max(2000).optional(),
      /** Roles/groups allowed to retrieve from this source; enforced by the RAG ACL stage. */
      acl: z.object({ roles: z.array(z.string()).default([]), subjects: z.array(z.string()).default([]) }).optional(),
      reindexSchedule: z.string().optional(),
    })
    .strict(),
  prompt: z.object({ template: z.string().min(1).max(100_000), variables: z.array(z.string()).default([]) }).strict(),
  'security-policy': z
    .object({
      /** Who may read conversation *content* in the platform (metadata is always operator+). */
      conversationContentAccess: z.enum(['none', 'operators']).default('none'),
      requireApprovalForDestructive: z.boolean().default(true),
      piiRedaction: z.boolean().default(true),
    })
    .strict(),
  budget: z
    .object({
      scope: z.enum(['tenant', 'project']),
      limitMicros: z.number().int().nonnegative(),
      period: z.enum(['day', 'month']),
      warnAt: z.number().min(0).max(1).optional(),
      action: z.enum(['warn', 'throttle', 'block', 'route-cheaper']),
      cheaperModel: z.object({ provider: name, model: z.string().min(1) }).optional(),
      throttle: z.object({ limit: z.number().int().positive(), windowMs: z.number().int().positive() }).optional(),
    })
    .strict(),
  'rate-limit': z.object({ scope: z.enum(['tenant', 'project', 'user']), limit: z.number().int().positive(), windowMs: z.number().int().positive() }).strict(),
} satisfies Record<ResourceKind, z.ZodType>;

export type ResourceSpec<K extends ResourceKind> = z.output<(typeof resourceSpecs)[K]>;

/** Prompt lifecycle (Section 96): a version is promoted draft -> staging -> production. */
export type VersionStage = 'draft' | 'staging' | 'production';

export interface Resource {
  readonly id: string;
  readonly tenantId: string;
  readonly projectId?: string;
  readonly environment?: string;
  readonly kind: ResourceKind;
  readonly name: string;
  readonly currentVersion: number;
  readonly enabled: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ResourceVersion {
  readonly resourceId: string;
  readonly version: number;
  readonly spec: unknown;
  readonly stage: VersionStage;
  readonly createdBy: string;
  readonly createdAt: string;
}

export function parseSpec<K extends ResourceKind>(kind: K, spec: unknown): ResourceSpec<K> {
  return resourceSpecs[kind].parse(spec) as ResourceSpec<K>;
}

const LEVEL_RANK: Readonly<Record<string, number>> = { none: 0, 'user-confirmation': 1, supervisor: 2, admin: 3, 'two-person': 4 };

/** True when `candidate` is at least as strict as `declared` (never weaker). */
export function isAtLeastAsStrict(candidate: string | undefined, declared: string | undefined): boolean {
  return (LEVEL_RANK[candidate ?? 'none'] ?? 0) >= (LEVEL_RANK[declared ?? 'none'] ?? 0);
}
