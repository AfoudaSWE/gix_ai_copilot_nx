import { useEffect, useMemo, useState } from 'react';
import { CardGrid, FeatureStatus, GixCard } from '../design/components.js';
import { InstallerCommand, PackageInstall } from '../design/code.js';
import { Icon } from '../design/icons.js';
import { Link, useScrollToHash } from '../router.js';
import { repoFile } from '../site.js';
import { cachedSource, loadSource } from './content.js';
import { DocsLayout, TableOfContents } from './layout.js';
import { extractHeadings } from './markdown-utils.js';
import { MarkdownPage } from './markdown.js';
import { docPath, findDoc, neighbours } from './nav.js';
import { SearchButton } from './search.js';

/** Markdown for a page: synchronous when preloaded (prerender/hydration), loaded otherwise. */
function useSource(source: string): { markdown?: string; error?: boolean } {
  const [state, setState] = useState<{ source: string; markdown?: string; error?: boolean }>(() => ({ source, markdown: cachedSource(source) }));
  useEffect(() => {
    let cancelled = false;
    const cached = cachedSource(source);
    if (cached !== undefined) {
      setState({ source, markdown: cached });
      return;
    }
    setState({ source });
    loadSource(source).then(
      (markdown) => !cancelled && setState({ source, markdown }),
      () => !cancelled && setState({ source, error: true }),
    );
    return () => {
      cancelled = true;
    };
  }, [source]);
  return state.source === source ? state : { markdown: cachedSource(source) };
}

function Feedback({ slug }: { readonly slug: string }) {
  const [answer, setAnswer] = useState<'yes' | 'no' | null>(null);
  useEffect(() => setAnswer(null), [slug]);
  return (
    <div className="doc-feedback" role="group" aria-label="Page feedback">
      {answer ? (
        <p role="status">Thanks for the feedback. {answer === 'no' && 'Use “Edit this page” or open an issue to tell us what was missing.'}</p>
      ) : (
        <>
          <p>Was this page helpful?</p>
          <button type="button" className="gix-button gix-button--secondary gix-button--sm" onClick={() => setAnswer('yes')}>
            <Icon name="thumbsUp" size={14} /> Yes
          </button>
          <button type="button" className="gix-button gix-button--secondary gix-button--sm" onClick={() => setAnswer('no')}>
            <Icon name="thumbsDown" size={14} /> No
          </button>
        </>
      )}
    </div>
  );
}

export function PrevNext({ slug }: { readonly slug: string }) {
  const { previous, next } = neighbours(slug);
  return (
    <nav className="doc-pager" aria-label="Previous and next pages">
      {previous ? (
        <Link href={docPath(previous.slug)} className="doc-pager__link">
          <span className="doc-pager__dir">
            <Icon name="chevronLeft" size={14} /> Previous
          </span>
          <span className="doc-pager__title">{previous.label}</span>
        </Link>
      ) : (
        <span />
      )}
      {next && (
        <Link href={docPath(next.slug)} className="doc-pager__link doc-pager__link--next">
          <span className="doc-pager__dir">
            Next <Icon name="chevronRight" size={14} />
          </span>
          <span className="doc-pager__title">{next.label}</span>
        </Link>
      )}
    </nav>
  );
}

export function DocArticle({ slug, source }: { readonly slug: string; readonly source: string }) {
  const entry = findDoc(slug);
  const { markdown, error } = useSource(source);
  const headings = useMemo(() => (markdown ? extractHeadings(markdown) : []), [markdown]);
  useScrollToHash(markdown !== undefined);
  return (
    <DocsLayout toc={<TableOfContents headings={headings} />}>
      <div className="doc">
        <div className="doc__meta">
          <nav aria-label="Breadcrumb" className="doc__breadcrumb">
            <ol>
              <li>
                <Link href="/docs">Docs</Link>
              </li>
              {entry && <li>{entry.section}</li>}
              {entry && <li aria-current="page">{entry.label}</li>}
            </ol>
          </nav>
          {entry?.status && <FeatureStatus status={entry.status} />}
        </div>
        {markdown !== undefined ? (
          <>
            <TableOfContents headings={headings} variant="inline" />
            <article className="doc__content">
              <MarkdownPage markdown={markdown} source={source} />
            </article>
          </>
        ) : error ? (
          <p role="alert">This page could not be loaded. Check your connection and try again.</p>
        ) : (
          <div className="doc__loading" aria-busy="true" aria-label="Loading page">
            <span />
            <span />
            <span />
          </div>
        )}
        <div className="doc__footer">
          <a href={repoFile(source, 'edit')} target="_blank" rel="noreferrer" className="doc__edit">
            <Icon name="github" size={16} /> Edit this page on GitHub
          </a>
          <Feedback slug={slug} />
        </div>
        <PrevNext slug={slug} />
      </div>
    </DocsLayout>
  );
}

const QUICK_LINKS = [
  { title: 'Quickstart', description: 'A streaming copilot in five minutes.', href: '/docs/quickstart', icon: 'rocket' },
  { title: 'React', description: 'Provider, hooks and ready-made chat UI.', href: '/docs/react', icon: 'layers' },
  { title: 'Vue', description: 'Plugin, composables and a chat component.', href: '/docs/vue', icon: 'layers' },
  { title: 'Angular', description: 'Signals, DI and an OnPush chat component.', href: '/docs/angular', icon: 'layers' },
  { title: 'Node.js', description: 'The copilot server: models, tools and security.', href: '/docs/node', icon: 'node' },
  { title: 'Tools', description: 'Connect AI to real application actions.', href: '/docs/tools', icon: 'tool' },
  { title: 'Generative UI', description: 'Render your trusted components from AI output.', href: '/docs/generative-ui', icon: 'layout' },
  { title: 'RAG', description: 'Permission-aware enterprise knowledge.', href: '/docs/rag', icon: 'database' },
  { title: 'Agents', description: 'Specialists, delegation and planning.', href: '/docs/agents', icon: 'bot' },
  { title: 'Workflows', description: 'Durable steps, approvals and compensation.', href: '/docs/workflows', icon: 'workflow' },
  { title: 'Security', description: 'The AI Action Firewall and approvals.', href: '/docs/security', icon: 'shield' },
  { title: 'Production', description: 'PostgreSQL, Redis, tenancy, budgets, Docker.', href: '/docs/production', icon: 'building' },
] as const;

const JOURNEYS = [
  {
    title: 'First copilot',
    icon: 'rocket',
    steps: [
      ['Install', '/docs/installation'],
      ['Quickstart', '/docs/quickstart'],
      ['Configure a model', '/docs/models'],
      ['Add context', '/docs/context'],
      ['Add a tool', '/docs/tools'],
      ['Generative UI', '/docs/generative-ui'],
    ],
  },
  {
    title: 'Enterprise architect',
    icon: 'building',
    steps: [
      ['Architecture', '/docs/architecture'],
      ['Security', '/docs/security'],
      ['RAG permissions', '/docs/rag'],
      ['Multi-tenancy', '/docs/multi-tenancy'],
      ['Observability', '/docs/production/observability'],
      ['Deployment', '/docs/deployment'],
    ],
  },
  {
    title: 'Agent developer',
    icon: 'workflow',
    steps: [
      ['Agents', '/docs/agents'],
      ['Tools', '/docs/tools'],
      ['Knowledge', '/docs/rag'],
      ['Memory', '/docs/memory'],
      ['Workflows', '/docs/workflows'],
      ['Test', '/docs/testing'],
      ['Evaluate', '/docs/evals'],
    ],
  },
] as const;

export function DocsHome() {
  return (
    <DocsLayout>
      <div className="doc docs-home">
        <header className="docs-home__hero gix-grid-bg">
          <span className="gix-eyebrow">Documentation · v0.1</span>
          <h1 tabIndex={-1}>GIX AI Documentation</h1>
          <p>Build secure, application-aware AI copilots and agents with TypeScript.</p>
          <div className="docs-home__search">
            <SearchButton />
          </div>
        </header>
        <section aria-labelledby="start">
          <h2 id="start">Start here</h2>
          <CardGrid>
            {QUICK_LINKS.map((link) => (
              <GixCard key={link.href} title={link.title} description={link.description} href={link.href} icon={link.icon} />
            ))}
          </CardGrid>
        </section>
        <section aria-labelledby="install">
          <h2 id="install">Install</h2>
          <p>Add a copilot to an existing React, Vue or Angular app, with a Node copilot server, in one command:</p>
          <InstallerCommand />
          <p className="docs-home__or">Or install the packages you need, for example React:</p>
          <PackageInstall packages={['@gixcopilot/react', '@gixcopilot/ui']} />
        </section>
        <section aria-labelledby="paths">
          <h2 id="paths">Learning paths</h2>
          <div className="journeys">
            {JOURNEYS.map((journey) => (
              <div key={journey.title} className="journey">
                <h3>
                  <Icon name={journey.icon} size={16} /> {journey.title}
                </h3>
                <ol>
                  {journey.steps.map(([label, href]) => (
                    <li key={href + label}>
                      <Link href={href}>{label}</Link>
                    </li>
                  ))}
                </ol>
              </div>
            ))}
          </div>
        </section>
        <section aria-labelledby="reference">
          <h2 id="reference">Reference</h2>
          <CardGrid>
            <GixCard title="API Reference" description="Every public export, with signatures from the shipped type declarations." href="/docs/api" icon="api" />
            <GixCard title="CLI" description="init, add tool/agent/mcp, import-openapi, eval, doctor." href="/docs/cli" icon="terminal" />
            <GixCard title="Examples" description="Runnable React, Angular and Node examples." href="/examples" icon="code" />
          </CardGrid>
        </section>
      </div>
    </DocsLayout>
  );
}
