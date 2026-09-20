import { HTMLElement, parse, type Node } from 'node-html-parser';

const NOISE_SELECTORS = 'script,style,nav,noscript,iframe,svg,header,footer';
const HEADING_TAGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);

function textOf(node: Node): string {
  return node.textContent.replace(/\s+/g, ' ').trim();
}

/**
 * Deterministic table-to-text representation (Section 33) - one line per row, cells joined by
 * " | ", header row (if any `<th>` is present) separated by a divider line. Not full table
 * layout understanding, just enough to keep a table's rows readable after chunking rather than
 * collapsing into an unreadable run-on fragment.
 */
export function serializeTable(table: HTMLElement): string {
  const rows = table.querySelectorAll('tr');
  const lines: string[] = [];
  for (const row of rows) {
    const cells = row.querySelectorAll('th,td').map((cell) => textOf(cell));
    if (cells.length === 0) continue;
    lines.push(cells.join(' | '));
    if (row.querySelector('th')) {
      lines.push(cells.map(() => '---').join(' | '));
    }
  }
  return lines.join('\n');
}

export interface HtmlStructureResult {
  readonly title?: string;
  /** Markdown-flavored plain text: headings become `#`.."######" lines, tables use serializeTable. */
  readonly text: string;
}

/**
 * Normalizes arbitrary HTML into readable structured text (Section 20/19), stripping script/
 * style/navigation noise while preserving headings/paragraphs/tables where practical - no claim
 * of perfect layout understanding (Section 18's caveat applies here too).
 */
export function extractHtmlStructure(html: string): HtmlStructureResult {
  const root = parse(html, { blockTextElements: { script: false, style: false } });
  root.querySelectorAll(NOISE_SELECTORS).forEach((node) => node.remove());

  const title = root.querySelector('title')?.text.trim() || undefined;
  const body = root.querySelector('body') ?? root;

  const lines: string[] = [];
  const visited = new Set<HTMLElement>();

  const walk = (node: HTMLElement): void => {
    if (visited.has(node)) return;
    const tag = node.tagName?.toLowerCase();

    if (tag === 'table') {
      visited.add(node);
      const serialized = serializeTable(node);
      if (serialized) lines.push(serialized);
      return;
    }
    if (tag && HEADING_TAGS.has(tag)) {
      visited.add(node);
      const level = Number(tag.slice(1));
      const text = textOf(node);
      if (text) lines.push(`${'#'.repeat(level)} ${text}`);
      return;
    }
    if (tag === 'p' || tag === 'li') {
      visited.add(node);
      const text = textOf(node);
      if (text) lines.push(text);
      return;
    }

    for (const child of node.childNodes) {
      if (child instanceof HTMLElement) {
        walk(child);
      }
    }
  };

  walk(body);

  const text = lines.length > 0 ? lines.join('\n\n') : textOf(body);
  // Falls back to the first extracted heading when there is no <title> tag - real-world HTML
  // fragments (mammoth's DOCX->HTML output has no <head>) still get a usable title this way.
  const firstHeadingMatch = /^#{1,6}\s+(.+)$/m.exec(text);
  const resolvedTitle = title ?? firstHeadingMatch?.[1]?.trim();
  return resolvedTitle !== undefined ? { title: resolvedTitle, text } : { text };
}
