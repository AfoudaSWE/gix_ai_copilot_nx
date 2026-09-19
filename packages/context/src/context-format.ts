import type { ContextScope } from './context-scope.js';

/**
 * Renders one item's stable, structured, model-facing block (Section 22). This is the only
 * place prompt text is assembled for a context item - application code registers structured
 * data; it never hand-formats a prompt string itself (see the context-engine skill).
 */
export function formatContextItemBlock(
  name: string,
  scope: ContextScope,
  description: string | undefined,
  serializedText: string,
): string {
  const lines = [`[Context: ${name}]`, `Scope: ${scope}`];
  if (description) lines.push(`Description: ${description}`);
  return `${lines.join('\n')}\n\n${serializedText}`;
}

/** Joins already-formatted item blocks into the single content string sent with a run. */
export function joinContextBlocks(blocks: readonly string[]): string {
  return blocks.join('\n\n---\n\n');
}
