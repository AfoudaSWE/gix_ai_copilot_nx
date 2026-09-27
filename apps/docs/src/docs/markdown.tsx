import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { ReactNode } from 'react';
import { Callout } from '../design/components.js';
import type { CalloutKind } from '../design/components.js';
import { CodeBlock } from '../design/code.js';
import { Icon } from '../design/icons.js';
import { Link } from '../router.js';
import { repoFile } from '../site.js';
import { createSlugger } from './markdown-utils.js';
import { routeForSource } from './nav.js';

/* ------------------------------------------------------------------ remark plugins (mdast) */

interface MdNode {
  type: string;
  value?: string;
  alt?: string;
  depth?: number;
  children?: MdNode[];
  data?: { hName?: string; hProperties?: Record<string, unknown> };
}

function textOf(node: MdNode): string {
  if (node.type === 'text' || node.type === 'inlineCode') return node.value ?? '';
  if (node.type === 'image') return node.alt ?? '';
  return (node.children ?? []).map(textOf).join('');
}

function visit(node: MdNode, fn: (node: MdNode) => void): void {
  fn(node);
  for (const child of node.children ?? []) visit(child, fn);
}

/** Gives every heading the same id the table of contents computes (markdown-utils). */
function remarkHeadingIds() {
  return (tree: MdNode) => {
    const slug = createSlugger();
    visit(tree, (node) => {
      if (node.type !== 'heading') return;
      node.data = { ...node.data, hProperties: { ...node.data?.hProperties, id: slug(textOf(node).trim()) } };
    });
  };
}

const CALLOUT_KINDS: Readonly<Record<string, CalloutKind>> = { NOTE: 'info', INFO: 'info', IMPORTANT: 'info', TIP: 'tip', WARNING: 'warning', CAUTION: 'warning', SECURITY: 'security', EXPERIMENTAL: 'experimental' };

/** GitHub-style alerts (`> [!TIP]`) become callouts; plain blockquotes stay blockquotes. */
function remarkCallouts() {
  return (tree: MdNode) => {
    visit(tree, (node) => {
      if (node.type !== 'blockquote') return;
      const paragraph = node.children?.[0];
      const first = paragraph?.type === 'paragraph' ? paragraph.children?.[0] : undefined;
      const match = first?.type === 'text' ? /^\[!(\w+)\][ \t]*\n?/.exec(first.value ?? '') : null;
      const kind = match?.[1] ? CALLOUT_KINDS[match[1].toUpperCase()] : undefined;
      if (!first || !match || !kind || !paragraph) return;
      first.value = (first.value ?? '').slice(match[0].length);
      if (!first.value && paragraph.children && paragraph.children.length === 1) node.children = node.children?.slice(1);
      node.data = { hName: 'div', hProperties: { 'data-callout': kind } };
    });
  };
}

/* ------------------------------------------------------------------ rendering (hast) */

interface HastNode {
  type: string;
  tagName?: string;
  value?: string;
  properties?: { className?: string[] | string };
  data?: { meta?: string };
  children?: HastNode[];
}

function hastText(node: HastNode | undefined): string {
  if (!node) return '';
  if (node.type === 'text') return node.value ?? '';
  return (node.children ?? []).map(hastText).join('');
}

/** Resolves a link written in a repository Markdown file. */
export function resolveDocHref(href: string, source: string): { href: string; internal: boolean } {
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('//')) return { href, internal: false };
  if (href.startsWith('#')) return { href, internal: true };
  const url = new URL(href, `https://repo.invalid/${source}`);
  const path = decodeURIComponent(url.pathname.slice(1));
  const route = routeForSource(path);
  if (route) return { href: `${route}${url.hash}`, internal: true };
  return { href: `${repoFile(path.replace(/\/$/, ''))}${url.hash}`, internal: false };
}

export function MarkdownPage({ markdown, source }: { readonly markdown: string; readonly source: string }) {
  return (
    <Markdown
      remarkPlugins={[remarkGfm, remarkHeadingIds, remarkCallouts]}
      components={{
        h1: ({ children, id }) => (
          <h1 id={id} tabIndex={-1}>
            {children}
          </h1>
        ),
        h2: ({ children, id }) => <AnchorHeading level={2} id={id}>{children}</AnchorHeading>,
        h3: ({ children, id }) => <AnchorHeading level={3} id={id}>{children}</AnchorHeading>,
        a: ({ href = '', children }) => {
          const target = resolveDocHref(href, source);
          return target.internal ? <Link href={target.href}>{children}</Link> : <a href={target.href} target="_blank" rel="noreferrer">{children}</a>;
        },
        pre: ({ node }) => {
          const code = (node as HastNode | undefined)?.children?.find((child) => child.tagName === 'code');
          const className = code?.properties?.className;
          const language = (Array.isArray(className) ? className : [className ?? '']).map(String).find((name) => name.startsWith('language-'))?.slice('language-'.length) ?? 'text';
          return <CodeBlock code={hastText(code)} language={language} meta={code?.data?.meta} />;
        },
        div: ({ node: _node, children, ...props }) => {
          const kind = (props as Record<string, unknown>)['data-callout'] as CalloutKind | undefined;
          return kind ? <Callout kind={kind}>{children}</Callout> : <div {...props}>{children}</div>;
        },
        table: ({ children }) => (
          <div className="doc-table" tabIndex={0} role="region" aria-label="Table">
            <table>{children}</table>
          </div>
        ),
        img: ({ src, alt }) => <img src={typeof src === 'string' ? src : undefined} alt={alt ?? ''} loading="lazy" decoding="async" />,
      }}
    >
      {markdown}
    </Markdown>
  );
}

/** A heading with a copyable deep link (the "#" appears on hover and keyboard focus). */
export function AnchorHeading({ level, id, children }: { readonly level: 2 | 3; readonly id?: string; readonly children: ReactNode }) {
  const Tag = level === 2 ? 'h2' : 'h3';
  return (
    <Tag id={id} className="doc-heading">
      {children}
      {id && (
        <a className="doc-heading__anchor" href={`#${id}`} aria-label="Link to this section">
          <Icon name="hash" size={14} />
        </a>
      )}
    </Tag>
  );
}
