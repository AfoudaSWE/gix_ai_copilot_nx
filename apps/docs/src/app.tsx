import { useEffect, useMemo, useRef, useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { PAGES, linkToSlug } from './content.js';

const REPO = 'https://github.com/AfoudaSWE/gix_ai_copilot_nx/blob/main/';

function current(): string {
  const slug = globalThis.location?.hash.replace(/^#\/?/, '') ?? '';
  return PAGES.some((page) => page.slug === slug) ? slug : (PAGES[0]?.slug ?? '');
}

export function App() {
  const [slug, setSlug] = useState(current);
  const [query, setQuery] = useState('');
  const mainRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const onHash = (): void => setSlug(current());
    globalThis.addEventListener?.('hashchange', onHash);
    return () => globalThis.removeEventListener?.('hashchange', onHash);
  }, []);
  useEffect(() => {
    mainRef.current?.querySelector<HTMLElement>('h1')?.focus();
  }, [slug]);
  const page = PAGES.find((candidate) => candidate.slug === slug) ?? PAGES[0];
  const filtered = useMemo(
    () => (query ? PAGES.filter((candidate) => `${candidate.title} ${candidate.markdown}`.toLowerCase().includes(query.toLowerCase())) : PAGES),
    [query],
  );
  const sections = [...new Set(filtered.map((candidate) => candidate.section))];
  const go = (target: string): void => {
    globalThis.location.hash = `#/${target}`;
    setSlug(target);
  };

  return (
    <div className="docs">
      <a
        className="skip-link"
        href="#doc"
        onClick={(event) => {
          event.preventDefault();
          mainRef.current?.focus();
        }}
      >
        Skip to content
      </a>
      <nav aria-label="Documentation" className="sidebar">
        <p className="brand">AI Copilot SDK</p>
        <label className="visually-hidden" htmlFor="search">
          Search documentation
        </label>
        <input id="search" type="search" placeholder="Search…" value={query} onChange={(event) => setQuery(event.target.value)} />
        {sections.map((section) => (
          <section key={section}>
            <h2>{section}</h2>
            <ul>
              {filtered
                .filter((candidate) => candidate.section === section)
                .map((candidate) => (
                  <li key={candidate.slug}>
                    <a
                      href={`#/${candidate.slug}`}
                      aria-current={candidate.slug === page?.slug ? 'page' : undefined}
                      onClick={(event) => {
                        event.preventDefault();
                        go(candidate.slug);
                      }}
                    >
                      {candidate.title}
                    </a>
                  </li>
                ))}
            </ul>
          </section>
        ))}
      </nav>
      <main id="doc" ref={mainRef} tabIndex={-1}>
        {page ? (
          <article>
            <Markdown
              remarkPlugins={[remarkGfm]}
              components={{
                h1: ({ children }) => <h1 tabIndex={-1}>{children}</h1>,
                a: ({ href = '', children }) => {
                  const target = linkToSlug(href);
                  if (target) {
                    return (
                      <a
                        href={`#/${target}`}
                        onClick={(event) => {
                          event.preventDefault();
                          go(target);
                        }}
                      >
                        {children}
                      </a>
                    );
                  }
                  const external = /^[a-z]+:/i.test(href);
                  const url = external || href.startsWith('#') ? href : `${REPO}${new URL(href, `https://x/${page.source}`).pathname.slice(1)}`;
                  return (
                    <a href={url} {...(external ? { rel: 'noreferrer', target: '_blank' } : {})}>
                      {children}
                    </a>
                  );
                },
                table: ({ children }) => (
                  <div className="table-wrap" tabIndex={0} role="region" aria-label="Table">
                    <table>{children}</table>
                  </div>
                ),
                pre: ({ children }) => (
                  <pre tabIndex={0} aria-label="Code example">
                    {children}
                  </pre>
                ),
              }}
            >
              {page.markdown}
            </Markdown>
            <p className="source">
              Source: <a href={`${REPO}${page.source}`}>{page.source}</a>
            </p>
          </article>
        ) : (
          <p>No documentation found.</p>
        )}
      </main>
    </div>
  );
}
