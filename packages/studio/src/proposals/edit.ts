import { z } from 'zod';
import { policyForTool } from '../generators/api-tools.js';
import type { ProposalItems } from './model.js';

const risk = z.enum(['read-only', 'write', 'destructive']);
const approval = z.enum(['none', 'user-confirmation', 'supervisor', 'admin', 'two-person']);
const toolName = z.string().regex(/^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)+$|^[a-z][a-zA-Z0-9]*$/, 'dot-separated camelCase segments');

/** Every field the Studio may edit before approval (§50). Anything else is rejected. */
export const proposalEditSchema = z.discriminatedUnion('collection', [
  z
    .object({
      collection: z.literal('tools'),
      id: z.string().min(1),
      changes: z
        .object({
          selected: z.boolean(),
          name: toolName,
          description: z.string().min(1).max(1000),
          risk,
          permission: z.string().regex(/^[A-Za-z][\w.:-]*$/).max(200).nullable(),
          approval,
          enabled: z.boolean(),
          agent: z.string().regex(/^[a-z][a-z0-9-]*$/).nullable(),
        })
        .partial()
        .strict(),
    })
    .strict(),
  z.object({ collection: z.literal('context'), id: z.string().min(1), changes: z.object({ selected: z.boolean(), description: z.string().min(1).max(1000), sensitivity: z.enum(['public', 'internal', 'sensitive', 'restricted']) }).partial().strict() }).strict(),
  z.object({ collection: z.literal('ui'), id: z.string().min(1), changes: z.object({ selected: z.boolean(), description: z.string().min(1).max(1000) }).partial().strict() }).strict(),
  z.object({ collection: z.literal('agents'), id: z.string().min(1), changes: z.object({ selected: z.boolean(), description: z.string().min(1).max(1000), instructions: z.string().min(1).max(8000) }).partial().strict() }).strict(),
  z.object({ collection: z.literal('skills'), id: z.string().min(1), changes: z.object({ selected: z.boolean(), description: z.string().min(1).max(1000) }).partial().strict() }).strict(),
  z.object({ collection: z.literal('knowledge'), id: z.string().min(1), changes: z.object({ selected: z.boolean() }).partial().strict() }).strict(),
  z.object({ collection: z.literal('policies'), id: z.string().min(1), changes: z.object({ selected: z.boolean() }).partial().strict() }).strict(),
  z.object({ collection: z.literal('configChanges'), id: z.string().min(1), changes: z.object({ selected: z.boolean() }).partial().strict() }).strict(),
]);

export type ProposalEdit = z.infer<typeof proposalEditSchema>;

export class ProposalEditError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProposalEditError';
  }
}

/**
 * Applies validated edits to a proposal's items (§50). Pure. Tool edits keep the linked
 * policy candidate in step, so review always shows the security that apply will write. The
 * security floor is not enforced here but by the security review, which approval re-runs.
 */
export function applyEdits(items: ProposalItems, edits: readonly unknown[]): ProposalItems {
  let next: ProposalItems = items;
  for (const raw of edits) {
    const parsed = proposalEditSchema.safeParse(raw);
    if (!parsed.success) throw new ProposalEditError(`Invalid edit: ${parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')}`);
    const edit = parsed.data;
    const collection = next[edit.collection] as readonly { readonly id: string }[];
    if (!collection.some((item) => item.id === edit.id)) throw new ProposalEditError(`No ${edit.collection} item "${edit.id}" in this proposal.`);
    if (edit.collection === 'tools') {
      const { permission, agent, ...rest } = edit.changes;
      const tools = next.tools.map((tool) => {
        if (tool.id !== edit.id) return tool;
        const updated = { ...tool, ...rest };
        const withPermission = permission === undefined ? updated : permission === null ? { ...updated, permission: undefined } : { ...updated, permission };
        return agent === undefined ? withPermission : agent === null ? { ...withPermission, agent: undefined } : { ...withPermission, agent };
      });
      const linked = new Set(next.policies.map((policy) => policy.id));
      const policies = next.policies.map((policy) => {
        const tool = tools.find((candidate) => `policy:${candidate.id}` === policy.id);
        return tool && linked.has(policy.id) ? policyForTool(tool) : policy;
      });
      next = { ...next, tools, policies };
    } else {
      next = { ...next, [edit.collection]: collection.map((item) => (item.id === edit.id ? { ...item, ...edit.changes } : item)) };
    }
  }
  return next;
}
