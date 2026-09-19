import { Children, isValidElement, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { DEFAULT_LABELS } from './labels.js';
import type { CopilotLabels } from './labels.js';

/** Safe text Markdown with no raw HTML, remote images, or executable URL protocols. */
export interface MarkdownProps {
  readonly content: string;
  readonly labels?: CopilotLabels;
}

/** Literal code block with an accessible clipboard control; no execution/highlighting. */
export interface CodeBlockProps {
  readonly code: string;
  readonly language?: string;
  readonly labels?: CopilotLabels;
}

/** Copy failures stay local and visible without exposing browser errors. */
export function CodeBlock({
  code,
  language,
  labels = DEFAULT_LABELS,
}: CodeBlockProps): ReactElement {
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'failed'>('idle');
  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(code);
      setCopyStatus('copied');
    } catch {
      setCopyStatus('failed');
    }
  }
  return (
    <div className="gix-code" dir="ltr">
      <div className="gix-code-toolbar">
        <span>{language || labels.code}</span>
        <button
          type="button"
          onClick={() => {
            void copy();
          }}
        >
          {copyStatus === 'copied'
            ? labels.copied
            : copyStatus === 'failed'
              ? labels.copyFailed
              : labels.copy}
        </button>
      </div>
      <pre tabIndex={0} aria-label={language || labels.code}>
        <code>{code}</code>
      </pre>
    </div>
  );
}

function codeText(node: ReactNode): string {
  return Children.toArray(node)
    .map((child) => {
      if (typeof child === 'string' || typeof child === 'number') return String(child);
      if (isValidElement<{ children?: ReactNode }>(child)) return codeText(child.props.children);
      return '';
    })
    .join('');
}

function safeUrl(url: string): string {
  // No whitespace/control obfuscation, protocol-relative URLs, data:, javascript:, etc.
  if (/[\u0000-\u0020\u007f]/.test(url) || url.startsWith('//') || url.includes('\\')) return '';
  if (/^(https?:|mailto:)/i.test(url) || !/^[^/?#]*:/.test(url)) return url;
  return '';
}

/** GFM tables/lists and code, rendered as React elements; raw HTML is discarded. */
export function Markdown({ content, labels = DEFAULT_LABELS }: MarkdownProps): ReactElement {
  return (
    <div className="gix-markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        urlTransform={safeUrl}
        disallowedElements={['img', 'input']}
        unwrapDisallowed
        components={{
          a: ({ href, children }) =>
            href ? (
              <a href={href} target="_blank" rel="noopener noreferrer">
                {children}
              </a>
            ) : (
              <span>{children}</span>
            ),
          pre: ({ children }) => {
            const child = Children.toArray(children)[0];
            const language = isValidElement<{ className?: string }>(child)
              ? /language-([\w+-]+)/.exec(child.props.className ?? '')?.[1]
              : undefined;
            return (
              <CodeBlock
                code={codeText(children).replace(/\n$/, '')}
                language={language}
                labels={labels}
              />
            );
          },
          table: ({ children }) => (
            <div
              className="gix-table-scroll"
              tabIndex={0}
              role="region"
              aria-label={labels.assistant}
            >
              <table>{children}</table>
            </div>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
