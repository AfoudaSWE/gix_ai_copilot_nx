import { isDevelopmentToolName } from '../planes.js';
import type { ChangeProposal } from './model.js';

/**
 * "Approve Safe Changes" (§44): the ids of items that are safe to approve in one click:
 * read-only tools with a known contract, non-restricted context, configuration, generative UI
 * components and the UI bootstrap the developer already chose. Never destructive or write
 * tools, conflicted or needs-review operations, agents, skills or knowledge.
 */
export function safeSelection(proposal: ChangeProposal): string[] {
  const tools = proposal.tools.filter((tool) => tool.suggestedRisk === 'read-only' && tool.risk === 'read-only' && tool.enabled && tool.confidence !== 'review' && (tool.conflicts ?? []).length === 0 && !isDevelopmentToolName(tool.name));
  return [
    ...tools.map((tool) => tool.id),
    ...proposal.context.filter((item) => item.sensitivity !== 'restricted').map((item) => item.id),
    ...proposal.configChanges.map((change) => change.id),
    ...proposal.ui.map((item) => item.id),
    ...proposal.integrations.filter((integration) => integration.selected).map((integration) => integration.id),
  ];
}
