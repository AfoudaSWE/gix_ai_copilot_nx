/**
 * Pure Markdown helpers shared by the renderer (heading ids), the "On this page" table of
 * contents and the build-time search index, so all three agree on the same anchors.
 * No DOM, no Node APIs: this module is imported by vite.config.ts as well.
 */
export interface Heading {
  readonly depth: 2 | 3;
  readonly text: string;
  readonly id: string;
}

export function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[`*_~[\](){}<>"'“”‘’.,:;!?/\\|@#$%^&+=]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-') || 'section'
  );
}

/** Creates a slugger that de-duplicates ids within one page (a, a-1, a-2 …). */
export function createSlugger(): (text: string) => string {
  const seen = new Map<string, number>();
  return (text) => {
    const base = slugify(text);
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count === 0 ? base : `${base}-${count}`;
  };
}

/** Inline Markdown to plain text (code spans, emphasis, links, images, HTML tags). */
export function stripInline(text: string): string {
  return text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)(.*?)\1/g, '$2')
    .replace(/<[^>]+>/g, '')
    .trim();
}

/** Removes fenced code blocks (keeps line count irrelevant) so headings inside code are ignored. */
function withoutFences(markdown: string): string[] {
  const lines: string[] = [];
  let fence: string | undefined;
  for (const line of markdown.replace(/\r\n/g, '\n').split('\n')) {
    const marker = /^\s*(```+|~~~+)/.exec(line)?.[1];
    if (marker) {
      if (!fence) fence = marker;
      else if (marker.startsWith(fence[0] ?? '`') && marker.length >= fence.length) fence = undefined;
      continue;
    }
    if (!fence) lines.push(line);
  }
  return lines;
}

/** The page's H1 (document title). */
export function titleOf(markdown: string, fallback: string): string {
  for (const line of withoutFences(markdown)) {
    const match = /^#\s+(.+?)\s*#*$/.exec(line);
    if (match?.[1]) return stripInline(match[1]);
  }
  return fallback;
}

/** H2/H3 headings with the ids the renderer assigns (same slugger, same order). */
export function extractHeadings(markdown: string): Heading[] {
  const slug = createSlugger();
  const headings: Heading[] = [];
  for (const line of withoutFences(markdown)) {
    const match = /^(#{1,6})\s+(.+?)\s*#*$/.exec(line);
    if (!match?.[1] || !match[2]) continue;
    const depth = match[1].length;
    const text = stripInline(match[2]);
    const id = slug(text);
    if (depth === 2 || depth === 3) headings.push({ depth, text, id });
  }
  return headings;
}

/** The first prose paragraph (used for page descriptions and search snippets). */
export function summaryOf(markdown: string, max = 180): string {
  const paragraphs = withoutFences(markdown)
    .join('\n')
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter((block) => block && !/^(#|>|\||-|\*|\d+\.|<!--|!\[)/.test(block));
  const first = stripInline((paragraphs[0] ?? '').replace(/\s+/g, ' '));
  return first.length > max ? `${first.slice(0, max - 1).replace(/\s+\S*$/, '')}…` : first;
}

/** Plain text per H2/H3 section, for the search index. */
export function sectionsOf(markdown: string): { readonly heading?: Heading; readonly text: string }[] {
  const headings = extractHeadings(markdown);
  const sections: { heading?: Heading; text: string[] }[] = [{ text: [] }];
  let index = 0;
  for (const line of withoutFences(markdown)) {
    const match = /^(#{1,6})\s+/.exec(line);
    if (match?.[1] && (match[1].length === 2 || match[1].length === 3)) {
      sections.push({ heading: headings[index], text: [] });
      index += 1;
      continue;
    }
    if (match) continue;
    sections[sections.length - 1]?.text.push(stripInline(line.replace(/^\s*([-*>]|\d+\.|\|)\s*/, '')));
  }
  return sections.map((section) => ({ heading: section.heading, text: section.text.join(' ').replace(/\s+/g, ' ').trim() }));
}
