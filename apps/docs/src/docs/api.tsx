import { useEffect, useMemo, useState } from 'react';
import { FeatureStatus } from '../design/components.js';
import { CodeBlock, PackageInstall } from '../design/code.js';
import { Icon } from '../design/icons.js';
import { Link, useScrollToHash } from '../router.js';
import { SITE, repoFile } from '../site.js';
import { cachedApi, loadApi } from '../routes.js';
import type { ApiItem, ApiPackage } from '../routes.js';
import { DocsLayout, TableOfContents } from './layout.js';
import { PrevNext } from './pages.js';

const GROUPS: readonly { readonly title: string; readonly slugs: readonly string[] }[] = [
  { title: 'Frontend', slugs: ['client', 'headless', 'react', 'ui', 'vue', 'angular', 'context', 'generative-ui'] },
  { title: 'Server and runtime', slugs: ['node', 'server', 'core', 'protocol', 'tools', 'security', 'provider', 'provider-openai', 'provider-mock', 'model-router'] },
  { title: 'Integrations', slugs: ['openapi', 'mcp', 'integrations'] },
  { title: 'Knowledge and memory', slugs: ['knowledge', 'rag', 'memory', 'vectorstore-pgvector'] },
  { title: 'Agents and workflows', slugs: ['agents', 'workflows', 'checkpoint-postgres', 'jobs'] },
  { title: 'Observability and quality', slugs: ['telemetry', 'devtools', 'testing', 'evals'] },
  { title: 'Production', slugs: ['config', 'tenancy', 'persistence-postgres', 'redis', 'usage', 'management'] },
  { title: 'Tooling', slugs: ['cli', 'create'] },
];

function useApi(): readonly ApiPackage[] | undefined {
  const [api, setApi] = useState(cachedApi);
  useEffect(() => {
    if (!api) void loadApi().then(setApi);
  }, [api]);
  return api;
}

function Loading() {
  return (
    <div className="doc__loading" aria-busy="true" aria-label="Loading API reference">
      <span />
      <span />
      <span />
    </div>
  );
}

export function ApiIndex() {
  const api = useApi();
  const [filter, setFilter] = useState('');
  const term = filter.trim().toLowerCase();
  const grouped = useMemo(() => {
    if (!api) return [];
    const known = new Set(GROUPS.flatMap((group) => group.slugs));
    const groups = [...GROUPS, { title: 'Other', slugs: api.map((pkg) => pkg.slug).filter((slug) => !known.has(slug)) }];
    return groups
      .map((group) => ({
        title: group.title,
        packages: group.slugs
          .map((slug) => api.find((pkg) => pkg.slug === slug))
          .filter((pkg): pkg is ApiPackage => pkg !== undefined)
          .filter((pkg) => !term || `${pkg.name} ${pkg.description}`.toLowerCase().includes(term) || [...pkg.values, ...pkg.types].some((item) => item.name.toLowerCase().includes(term))),
      }))
      .filter((group) => group.packages.length > 0);
  }, [api, term]);
  const symbolMatches = useMemo(() => {
    if (!api || term.length < 2) return [];
    return api.flatMap((pkg) => [...pkg.values, ...pkg.types].filter((item) => item.name.toLowerCase().includes(term) && item.signature).map((item) => ({ pkg, item }))).slice(0, 30);
  }, [api, term]);

  return (
    <DocsLayout>
      <div className="doc api">
        <header className="api__header">
          <span className="gix-eyebrow">Reference</span>
          <h1 tabIndex={-1}>API Reference</h1>
          <p>Every public export of every <code>@gixcopilot</code> package, generated from the type declarations each package ships. Anything not listed here is internal.</p>
        </header>
        <div className="api__filter">
          <Icon name="search" size={16} />
          <label className="visually-hidden" htmlFor="api-filter">
            Filter packages and APIs
          </label>
          <input id="api-filter" type="search" placeholder="Filter: useCopilotContext, defineTool, createAgentRuntime…" value={filter} onChange={(event) => setFilter(event.target.value)} />
        </div>
        {!api ? (
          <Loading />
        ) : grouped.length === 0 ? (
          <p className="api__empty" role="status">
            Nothing matches “{filter}”. Try part of a name, such as “copilot” or “tool”.
          </p>
        ) : (
          <>
            {symbolMatches.length > 0 && (
              <section aria-labelledby="api-matches">
                <h2 id="api-matches">Matching APIs</h2>
                <ul className="api__matches">
                  {symbolMatches.map(({ pkg, item }) => (
                    <li key={`${pkg.slug}-${item.name}`}>
                      <Link href={`/docs/api/${pkg.slug}#${encodeURIComponent(item.name)}`}>
                        <code>{item.name}</code>
                      </Link>
                      <span className="api__kind">{item.kind}</span>
                      <span className="api__pkg">{pkg.name}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {grouped.map((group) => (
              <section key={group.title} aria-labelledby={`group-${group.title}`}>
                <h2 id={`group-${group.title}`}>{group.title}</h2>
                <div className="api__packages">
                  {group.packages.map((pkg) => (
                    <Link key={pkg.slug} href={`/docs/api/${pkg.slug}`} className="gix-card api__package">
                      <span className="api__package-head">
                        <code>{pkg.name}</code>
                        <FeatureStatus status={pkg.status} />
                      </span>
                      <p>{pkg.description}</p>
                      <span className="api__count">
                        {pkg.values.length} values · {pkg.types.length} types
                      </span>
                    </Link>
                  ))}
                </div>
              </section>
            ))}
          </>
        )}
        <PrevNext slug="api" />
      </div>
    </DocsLayout>
  );
}

function Symbol({ item, pkg, api }: { readonly item: ApiItem; readonly pkg: ApiPackage; readonly api: readonly ApiPackage[] }) {
  const name = item.name.replace(/ \(namespace\)$/, '');
  // A symbol without a local declaration is re-exported from another package.
  const origin = item.signature ? undefined : api.find((other) => other !== pkg && [...other.values, ...other.types].some((candidate) => candidate.name === item.name && candidate.signature));
  const declared = origin ? [...origin.values, ...origin.types].find((candidate) => candidate.name === item.name) : item;
  return (
    <article className="api-symbol" id={encodeURIComponent(name)} aria-labelledby={`sym-${encodeURIComponent(name)}`}>
      <header className="api-symbol__head">
        <h3 id={`sym-${encodeURIComponent(name)}`}>
          <code>{name}</code>
        </h3>
        {declared?.kind && <span className="api__kind">{declared.kind}</span>}
        <a className="doc-heading__anchor" href={`#${encodeURIComponent(name)}`} aria-label={`Link to ${name}`}>
          <Icon name="hash" size={14} />
        </a>
      </header>
      {origin && (
        <p className="api-symbol__origin">
          Re-exported from <Link href={`/docs/api/${origin.slug}#${encodeURIComponent(name)}`}>{origin.name}</Link>.
        </p>
      )}
      {declared?.signature ? <CodeBlock code={declared.signature} language="ts" chrome={false} /> : !origin && <p className="api-symbol__origin">Namespace or re-export; see the package README.</p>}
    </article>
  );
}

export function ApiPackagePage({ slug }: { readonly slug: string }) {
  const api = useApi();
  const pkg = api?.find((item) => item.slug === slug);
  useScrollToHash(pkg !== undefined);
  const [filter, setFilter] = useState('');
  const term = filter.trim().toLowerCase();
  const values = pkg?.values.filter((item) => item.name.toLowerCase().includes(term)) ?? [];
  const types = pkg?.types.filter((item) => item.name.toLowerCase().includes(term)) ?? [];
  const headings = pkg
    ? [
        { depth: 2 as const, text: 'Install', id: 'install' },
        { depth: 2 as const, text: `Values (${pkg.values.length})`, id: 'values' },
        { depth: 2 as const, text: `Types (${pkg.types.length})`, id: 'types' },
      ]
    : [];
  return (
    <DocsLayout toc={<TableOfContents headings={headings} />}>
      <div className="doc api">
        {!api ? (
          <Loading />
        ) : !pkg ? (
          <div>
            <h1 tabIndex={-1}>Package not found</h1>
            <p>
              There is no package named “{slug}”. See the <Link href="/docs/api">API Reference</Link>.
            </p>
          </div>
        ) : (
          <>
            <nav aria-label="Breadcrumb" className="doc__breadcrumb">
              <ol>
                <li>
                  <Link href="/docs">Docs</Link>
                </li>
                <li>
                  <Link href="/docs/api">API Reference</Link>
                </li>
                <li aria-current="page">{pkg.name}</li>
              </ol>
            </nav>
            <header className="api__header">
              <h1 tabIndex={-1}>
                <code>{pkg.name}</code>
              </h1>
              <p>{pkg.description}</p>
              <p className="api__links">
                <FeatureStatus status={pkg.status} />
                <a href={repoFile(`${pkg.directory}/README.md`)} target="_blank" rel="noreferrer">
                  README
                </a>
                <a href={`https://www.npmjs.com/package/${pkg.name}`} target="_blank" rel="noreferrer">
                  npm
                </a>
                <a href={`${SITE.github}/tree/${SITE.branch}/${pkg.directory}`} target="_blank" rel="noreferrer">
                  Source
                </a>
              </p>
            </header>
            <h2 id="install" className="doc-heading">
              Install
            </h2>
            <PackageInstall packages={[pkg.name, ...pkg.peerDependencies.filter((peer) => !peer.startsWith('@types/'))]} />
            {pkg.subpaths.length > 0 && (
              <p>
                Subpath exports:{' '}
                {pkg.subpaths.map((path) => (
                  <code key={path}>{path} </code>
                ))}
              </p>
            )}
            <div className="api__filter">
              <Icon name="search" size={16} />
              <label className="visually-hidden" htmlFor="symbol-filter">
                Filter {pkg.name} exports
              </label>
              <input id="symbol-filter" type="search" placeholder={`Filter ${pkg.values.length + pkg.types.length} exports…`} value={filter} onChange={(event) => setFilter(event.target.value)} />
            </div>
            <h2 id="values" className="doc-heading">
              Values ({pkg.values.length})
            </h2>
            {values.length === 0 ? <p className="api__empty">{term ? 'No values match the filter.' : 'This package exports no runtime values.'}</p> : values.map((item) => <Symbol key={item.name} item={item} pkg={pkg} api={api} />)}
            <h2 id="types" className="doc-heading">
              Types ({pkg.types.length})
            </h2>
            {types.length === 0 ? <p className="api__empty">{term ? 'No types match the filter.' : 'This package exports no types.'}</p> : types.map((item) => <Symbol key={item.name} item={item} pkg={pkg} api={api} />)}
          </>
        )}
      </div>
    </DocsLayout>
  );
}
