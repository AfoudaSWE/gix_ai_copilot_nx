/**
 * Shared text normalization (Section 26) applied by every loader before a KnowledgeDocument is
 * produced: consistent line endings and collapsed excessive blank space, without destroying
 * meaningful structure (paragraph breaks are preserved, not collapsed to nothing).
 */
export function normalizeText(raw: string): string {
  return raw
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
