import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from './icons.js';
import { LANGUAGE_LABEL, parseMeta, toLines, tokenize } from './highlight.js';
import { Tabs } from './components.js';

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback for browsers/contexts without the async clipboard API.
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.append(area);
    area.select();
    const ok = document.execCommand?.('copy') ?? false;
    area.remove();
    return ok;
  }
}

export function CopyButton({ text, label = 'Copy code' }: { readonly text: string; readonly label?: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <button
      type="button"
      className="gix-code__action"
      data-copied={copied}
      aria-label={copied ? 'Copied' : label}
      onClick={() => {
        void copyText(text).then((ok) => {
          if (!ok) return;
          setCopied(true);
          clearTimeout(timer.current);
          timer.current = setTimeout(() => setCopied(false), 1800);
        });
      }}
    >
      <Icon name={copied ? 'check' : 'copy'} size={14} />
      <span aria-hidden="true">{copied ? 'Copied' : 'Copy'}</span>
      <span className="visually-hidden" role="status">
        {copied ? 'Copied to clipboard' : ''}
      </span>
    </button>
  );
}

export interface CodeBlockProps {
  readonly code: string;
  readonly language?: string;
  /** File name shown in the title bar. */
  readonly title?: string;
  /** Raw fence meta (`title="a.ts" {2-3}`); parsed when `title`/`highlight` are absent. */
  readonly meta?: string;
  readonly highlight?: readonly number[];
  readonly chrome?: boolean;
}

/** GixCodeWindow: highlighted, copyable code with file name, language, line highlight and wrap toggle. */
export function CodeBlock({ code, language = 'text', title, meta, highlight, chrome = true }: CodeBlockProps) {
  const [wrap, setWrap] = useState(false);
  const source = code.replace(/\n$/, '');
  const parsed = useMemo(() => parseMeta(meta), [meta]);
  const lines = useMemo(() => toLines(tokenize(source, language)), [source, language]);
  const marked = highlight ? new Set(highlight) : parsed.highlight;
  const name = title ?? parsed.title;
  const label = LANGUAGE_LABEL[language] ?? (language === 'text' ? '' : language);
  return (
    <figure className={`gix-code${wrap ? ' gix-code--wrap' : ''}`}>
      {chrome && (
        <figcaption className="gix-code__bar">
          <span className="gix-code__dots" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
          {name && <span className="gix-code__title">{name}</span>}
          {label && <span className="gix-code__lang">{label}</span>}
          <span className="gix-code__actions" style={label ? undefined : { marginInlineStart: 'auto' }}>
            <button type="button" className="gix-code__action" aria-pressed={wrap} aria-label="Wrap long lines" onClick={() => setWrap((value) => !value)}>
              <Icon name="wrap" size={14} />
            </button>
            <CopyButton text={source} />
          </span>
        </figcaption>
      )}
      <pre tabIndex={0} aria-label={name ? `Code: ${name}` : `${label || 'Code'} example`}>
        <code className={`language-${language}`}>
          {lines.map((tokens, index) => (
            <span key={index} className={`gix-code__line${marked.has(index + 1) ? ' gix-code__line--hl' : ''}`}>
              {tokens.map((token, tokenIndex) =>
                token.type === 'plain' ? (
                  token.text
                ) : (
                  <span key={tokenIndex} className={`tok-${token.type}`}>
                    {token.text}
                  </span>
                ),
              )}
              {'\n'}
            </span>
          ))}
        </code>
      </pre>
    </figure>
  );
}

/** The same concept in several frameworks (React | Vue | Angular | Node …). */
export function CodeTabs({ label, tabs }: { readonly label: string; readonly tabs: readonly { readonly label: string; readonly code: string; readonly language: string; readonly title?: string }[] }) {
  return <Tabs label={label} tabs={tabs.map((tab) => ({ id: tab.label.toLowerCase().replace(/\W+/g, '-'), label: tab.label, content: <CodeBlock code={tab.code} language={tab.language} title={tab.title} /> }))} />;
}

const MANAGERS = [
  ['npm', 'npm install'],
  ['pnpm', 'pnpm add'],
  ['yarn', 'yarn add'],
  ['bun', 'bun add'],
] as const;

/** Install command in each package manager, with only the real package names passed in. */
export function PackageInstall({ packages }: { readonly packages: readonly string[] }) {
  return <Tabs label="Package manager" tabs={MANAGERS.map(([id, command]) => ({ id, label: id, content: <CodeBlock code={`${command} ${packages.join(' ')}`} language="bash" /> }))} />;
}

const CREATE = [
  ['npm', 'npm create @gixcopilot@latest'],
  ['pnpm', 'pnpm create @gixcopilot'],
  ['yarn', 'yarn create @gixcopilot'],
  ['bun', 'bunx @gixcopilot/create'],
] as const;

/** The one-command installer (@gixcopilot/create) in each package manager. */
export function InstallerCommand() {
  return <Tabs label="Package manager" tabs={CREATE.map(([id, command]) => ({ id, label: id, content: <CodeBlock code={command} language="bash" /> }))} />;
}

export interface TerminalLine {
  readonly kind: 'command' | 'output' | 'success';
  readonly text: string;
}

/**
 * A terminal that types its commands once when it scrolls into view. With reduced motion (or
 * before JavaScript runs) the full transcript is shown immediately.
 */
export function Terminal({ title = 'Terminal', lines }: { readonly title?: string; readonly lines: readonly TerminalLine[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(lines.length);
  const [typed, setTyped] = useState<number | null>(null);
  useEffect(() => {
    const element = ref.current;
    const reduce = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? true;
    if (!element || reduce || typeof IntersectionObserver === 'undefined') return;
    setShown(0);
    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const run = (index: number): void => {
      if (cancelled || index >= lines.length) return;
      const line = lines[index];
      if (line?.kind === 'command') {
        let chars = 0;
        const tick = (): void => {
          if (cancelled) return;
          chars += 1;
          setShown(index);
          setTyped(chars);
          if (chars < line.text.length) timers.push(setTimeout(tick, 28));
          else {
            setTyped(null);
            setShown(index + 1);
            timers.push(setTimeout(() => run(index + 1), 350));
          }
        };
        tick();
      } else {
        setShown(index + 1);
        timers.push(setTimeout(() => run(index + 1), 220));
      }
    };
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        observer.disconnect();
        run(0);
      }
    });
    observer.observe(element);
    return () => {
      cancelled = true;
      observer.disconnect();
      timers.forEach(clearTimeout);
    };
  }, [lines]);

  const transcript = lines.map((line) => (line.kind === 'command' ? `$ ${line.text}` : line.text)).join('\n');
  return (
    <div className="gix-terminal" ref={ref}>
      <div className="gix-code__bar">
        <span className="gix-code__dots" aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
        <span className="gix-code__title">{title}</span>
        <span className="gix-code__actions" style={{ marginInlineStart: 'auto' }}>
          <CopyButton text={lines.filter((line) => line.kind === 'command').map((line) => line.text).join('\n')} label="Copy commands" />
        </span>
      </div>
      <pre className="gix-terminal__body" aria-label={`${title} transcript`} tabIndex={0}>
        <span className="visually-hidden">{transcript}</span>
        <span aria-hidden="true">
          {lines.slice(0, typed === null ? shown : shown + 1).map((line, index) => {
            const text = typed !== null && index === shown ? line.text.slice(0, typed) : line.text;
            return (
              <span key={index} className={`gix-terminal__line gix-terminal__line--${line.kind}`}>
                {line.kind === 'command' && <span className="tok-prompt">$ </span>}
                {line.kind === 'success' && <span className="gix-terminal__check">✓ </span>}
                {text}
                {typed !== null && index === shown && <span className="gix-terminal__cursor" />}
                {'\n'}
              </span>
            );
          })}
        </span>
      </pre>
    </div>
  );
}
