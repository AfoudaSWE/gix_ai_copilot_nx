import { z } from 'zod';
import { createRuntime } from '@gixcopilot/core';
import { createModelRuntime } from '@gixcopilot/provider';
import { createOpenAIProvider } from '@gixcopilot/provider-openai';
import { createServer } from '@gixcopilot/server';
import { createToolRegistry, defineTool } from '@gixcopilot/tools';
import {
  allow, createActionFirewall, createFieldRedactionDataPolicy, createInMemoryApprovalStore,
  createInMemoryAuditSink, createPolicyRegistry, createStaticAuthenticationAdapter, definePolicy, deny,
} from '@gixcopilot/security';
import type { Identity } from '@gixcopilot/security';
import { CopilotError } from '@gixcopilot/protocol';
import type { ToolApprovalLevel } from '@gixcopilot/protocol';

/** Demonstration credentials only. Replace with the host application's session adapter. */
export const IDENTITIES: Readonly<Record<string, Identity>> = {
  viewer: { subject: 'viewer', roles: ['viewer'], permissions: ['applications.view'], attributes: { tenantId: 'demo' } },
  officer: { subject: 'officer', roles: ['officer'], permissions: ['applications.view', 'applications.write', 'applications.delete'], attributes: { tenantId: 'demo' } },
  supervisor: { subject: 'supervisor', roles: ['supervisor'], permissions: ['approvals.supervisor', 'approvals.two-person', 'audit.read'], attributes: { tenantId: 'demo' } },
  supervisor2: { subject: 'supervisor2', roles: ['supervisor'], permissions: ['approvals.supervisor', 'approvals.two-person', 'audit.read'], attributes: { tenantId: 'demo' } },
  admin: { subject: 'admin', roles: ['administrator'], permissions: ['approvals.admin', 'audit.read'], attributes: { tenantId: 'demo' } },
};

/** Creates a real in-memory application plus security services; no simulated model. */
export function createEnterpriseServer(config: { readonly apiKey?: string; readonly model?: string } = {}): ReturnType<typeof createServer> {
  const records = new Map([
    ['APP-1024', { tenantId: 'demo', assignee: 'Officer A', status: 'PENDING', version: 1, passportNumber: 'A12345678', email: 'applicant@example.com' }],
    ['APP-2048', { tenantId: 'other', assignee: 'Officer C', status: 'PENDING', version: 1, passportNumber: 'B87654321', email: 'other@example.com' }],
  ]);
  const registry = createToolRegistry();
  registry.register(defineTool({
    name: 'applications.get', description: 'Read an application. APP-1024 belongs to the demo tenant.',
    input: z.object({ applicationId: z.string() }), security: { requiredPermissions: ['applications.view'], risk: 'read-only' },
    execute: ({ applicationId }) => Promise.resolve(records.get(applicationId)),
  }));
  for (const [suffix, approval] of Object.entries({ confirm: 'user-confirmation', reassign: 'supervisor', transfer: 'two-person', delete: 'admin' } as const)) {
    const destructive = suffix === 'delete';
    registry.register(defineTool({
      name: `applications.${suffix}`, description: destructive ? 'Permanently delete an application after admin approval.' : `Assign an application to another officer with ${approval} approval.`,
      input: z.object({ applicationId: z.string(), officerId: z.string().default('Officer B') }),
      security: { requiredPermissions: [destructive ? 'applications.delete' : 'applications.write'],
        risk: destructive ? 'destructive' : 'write', reversibility: destructive ? 'irreversible' : 'reversible', approval: approval as ToolApprovalLevel },
      dryRun: ({ applicationId, officerId }) => Promise.resolve({
        summary: destructive ? `Delete ${applicationId} permanently` : `Reassign ${applicationId}`,
        changes: [
          { field: 'assignee', before: records.get(applicationId)?.assignee, after: destructive ? '(deleted)' : officerId },
          { field: 'version', before: records.get(applicationId)?.version, after: (records.get(applicationId)?.version ?? 0) + 1 },
        ], warnings: destructive ? ['This cannot be undone.'] : [],
      }),
      execute: ({ applicationId, officerId }) => {
        const record = records.get(applicationId);
        if (!record) throw new Error('Application not found');
        if (destructive) records.delete(applicationId);
        else records.set(applicationId, { ...record, assignee: officerId, version: record.version + 1 });
        return Promise.resolve({ applicationId, outcome: destructive ? 'deleted' : 'reassigned', assignee: officerId });
      },
    }));
  }
  const policies = createPolicyRegistry([definePolicy({
    id: 'applications.tenant-and-status', evaluate({ input, tenant, action }) {
      const parsed = z.object({ applicationId: z.string() }).safeParse(input);
      const record = parsed.success ? records.get(parsed.data.applicationId) : undefined;
      if (!record || record.tenantId !== tenant?.tenantId) return deny('Application is not available in your tenant.', 'TENANT_MISMATCH');
      if (action !== 'applications.get' && record.status === 'APPROVED') return deny('Approved applications cannot be changed.');
      return allow();
    },
  })]);
  const audit = createInMemoryAuditSink();
  const app = createServer({
    runtime: createRuntime({ executor: { async *execute() { await Promise.resolve(); throw CopilotError.validation('Configure OPENAI_API_KEY and OPENAI_MODEL for chat.'); } } }), toolRegistry: registry,
    modelRuntime: config.apiKey ? createModelRuntime({ providers: [createOpenAIProvider({ apiKey: config.apiKey })] }) : undefined,
    authenticationAdapter: createStaticAuthenticationAdapter(IDENTITIES),
    actionFirewall: createActionFirewall({ policies, audit }), approvals: createInMemoryApprovalStore(),
    dataPolicy: createFieldRedactionDataPolicy([
      { field: 'passportNumber', classification: 'pii' },
      { field: 'email', classification: 'pii', redact: () => '[email hidden]' },
    ]), actionHistory: audit, approvalExpiresInMs: 5 * 60_000,
  });
  app.get('/demo-config', () => ({ model: config.apiKey ? config.model : null }));
  return app;
}
