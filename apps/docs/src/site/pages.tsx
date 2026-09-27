import { useMemo, useState } from 'react';
import { CardGrid, GixButton, GixCard, GixGradientText, GixSectionHeading } from '../design/components.js';
import { Icon } from '../design/icons.js';
import { useSearch } from '../docs/search.js';
import { Link } from '../router.js';
import { SITE } from '../site.js';
import { SiteLayout } from './chrome.js';
import { ApprovalCard, FirewallPipeline, TracePreview } from './demos.js';

/* --------------------------------------------------------------------------- Examples */

type Framework = 'React' | 'Angular' | 'Node';
type Capability = 'Copilot' | 'Context' | 'Tools' | 'Generative UI' | 'RAG' | 'Memory' | 'Agents' | 'Workflows' | 'Security' | 'OpenAPI' | 'MCP' | 'DevTools' | 'Evaluations';

export interface Example {
  readonly dir: string;
  readonly title: string;
  readonly framework: Framework;
  readonly capabilities: readonly Capability[];
  readonly description: string;
  readonly guide: string;
}

/** Every entry is a real directory under examples/ with its own tests. */
export const EXAMPLES: readonly Example[] = [
  { dir: 'react-basic', title: 'React interface lab', framework: 'React', capabilities: ['Copilot'], description: 'Popup, embedded chat and sidebar over the real server with the labelled mock provider; themes, RTL, stop and retry.', guide: '/docs/react' },
  { dir: 'react-custom-ui', title: 'React custom UI', framework: 'React', capabilities: ['Copilot'], description: 'useCopilotChat() with entirely your own markup and CSS.', guide: '/docs/react' },
  { dir: 'react-context', title: 'Application context', framework: 'React', capabilities: ['Context'], description: 'Page, user and selected-entity context plus shared state, with the context inspector.', guide: '/docs/context' },
  { dir: 'react-tools', title: 'Tools and agent actions', framework: 'React', capabilities: ['Tools'], description: 'Frontend and backend tools on the canonical tool runtime, no API key required.', guide: '/docs/tools' },
  { dir: 'react-generative-ui', title: 'Generative UI and shared state', framework: 'React', capabilities: ['Generative UI', 'Tools'], description: 'Trusted components selected by the model, tool renderers and model-proposed state patches (real OpenAI).', guide: '/docs/generative-ui' },
  { dir: 'react-rag', title: 'Knowledge, RAG and memory', framework: 'React', capabilities: ['RAG', 'Memory'], description: 'Tenant and permission-tiered documents, citations and explicit memory.', guide: '/docs/rag' },
  { dir: 'react-enterprise', title: 'Enterprise security and approvals', framework: 'React', capabilities: ['Security'], description: 'Authentication, RBAC/ABAC, tenant isolation and risk-based human-in-the-loop approvals.', guide: '/docs/security' },
  { dir: 'angular-basic', title: 'Angular copilot', framework: 'Angular', capabilities: ['Copilot', 'Context', 'Tools', 'Generative UI'], description: 'Signal context, a frontend tool, shared state and a trusted generative component with <aicopilot-chat>.', guide: '/docs/angular' },
  { dir: 'node-basic', title: 'Node copilot', framework: 'Node', capabilities: ['Copilot'], description: 'createCopilot() on plain Node: run, stream and serve HTTP/SSE.', guide: '/docs/node' },
  { dir: 'model-streaming', title: 'Model streaming', framework: 'Node', capabilities: ['Copilot'], description: 'Client → server → model runtime → provider → SSE, with optional real OpenAI.', guide: '/docs/models' },
  { dir: 'openapi', title: 'OpenAPI tools', framework: 'Node', capabilities: ['OpenAPI', 'Tools'], description: 'A local test API and spec, registerOpenAPI() and the model → generated tool → HTTP pipeline.', guide: '/docs/openapi' },
  { dir: 'mcp', title: 'MCP tools', framework: 'Node', capabilities: ['MCP', 'Tools'], description: 'A local MCP server, registerMCP() and the model → generated tool → MCP pipeline.', guide: '/docs/mcp' },
  { dir: 'agent-basic', title: 'Single agent', framework: 'Node', capabilities: ['Agents', 'RAG', 'Memory'], description: 'One agent with a model, a backend tool, knowledge, memory and a trusted security context.', guide: '/docs/agents' },
  { dir: 'multi-agent', title: 'Multi-agent orchestration', framework: 'Node', capabilities: ['Agents', 'Security'], description: 'An orchestrator delegating to specialists, proving delegation never expands privileges.', guide: '/docs/agents' },
  { dir: 'workflow-approval', title: 'Workflow with approval', framework: 'Node', capabilities: ['Workflows', 'Security'], description: 'Validate, agent step, payment check, supervisor approval (pause, persist, resume), update.', guide: '/docs/workflows' },
  { dir: 'workflow-compensation', title: 'Workflow compensation', framework: 'Node', capabilities: ['Workflows'], description: 'A failed shipment triggers refund and release in reverse order, all through the firewall.', guide: '/docs/workflows' },
  { dir: 'devtools', title: 'DevTools session', framework: 'Node', capabilities: ['DevTools'], description: 'One app recording chat, tools, approvals, RAG, agents and workflows into a DevTools session.', guide: '/docs/devtools' },
  { dir: 'evals', title: 'Evaluations', framework: 'Node', capabilities: ['Evaluations', 'Security'], description: 'A versioned dataset with adversarial cases, baselines and CI gates.', guide: '/docs/evals' },
];

const FRAMEWORKS: readonly Framework[] = ['React', 'Angular', 'Node'];
const CAPABILITIES: readonly Capability[] = ['Copilot', 'Context', 'Tools', 'Generative UI', 'RAG', 'Memory', 'Agents', 'Workflows', 'Security', 'OpenAPI', 'MCP', 'DevTools', 'Evaluations'];

function FilterChips<T extends string>({ label, options, value, onChange }: { readonly label: string; readonly options: readonly T[]; readonly value: T | null; readonly onChange: (value: T | null) => void }) {
  return (
    <fieldset className="chips">
      <legend>{label}</legend>
      <button type="button" className="chip" aria-pressed={value === null} onClick={() => onChange(null)}>
        All
      </button>
      {options.map((option) => (
        <button key={option} type="button" className="chip" aria-pressed={value === option} onClick={() => onChange(value === option ? null : option)}>
          {option}
        </button>
      ))}
    </fieldset>
  );
}

export function ExamplesPage() {
  const [framework, setFramework] = useState<Framework | null>(null);
  const [capability, setCapability] = useState<Capability | null>(null);
  const [query, setQuery] = useState('');
  const results = useMemo(() => {
    const term = query.trim().toLowerCase();
    return EXAMPLES.filter((example) => (!framework || example.framework === framework) && (!capability || example.capabilities.includes(capability)) && (!term || `${example.title} ${example.description} ${example.dir}`.toLowerCase().includes(term)));
  }, [framework, capability, query]);
  return (
    <SiteLayout>
      <section className="page-hero gix-grid-bg">
        <div className="container">
          <span className="gix-eyebrow">Examples</span>
          <h1 tabIndex={-1}>Runnable examples</h1>
          <p>Each example is a real application in the repository with its own tests. Most run without an API key using the labelled mock provider.</p>
        </div>
      </section>
      <div className="container examples">
        <div className="examples__filters">
          <div className="api__filter">
            <Icon name="search" size={16} />
            <label className="visually-hidden" htmlFor="example-search">
              Search examples
            </label>
            <input id="example-search" type="search" placeholder="Search examples…" value={query} onChange={(event) => setQuery(event.target.value)} />
          </div>
          <FilterChips label="Framework" options={FRAMEWORKS} value={framework} onChange={setFramework} />
          <FilterChips label="Capability" options={CAPABILITIES} value={capability} onChange={setCapability} />
        </div>
        <p className="examples__count" role="status">
          {results.length} {results.length === 1 ? 'example' : 'examples'}
        </p>
        {results.length === 0 ? (
          <div className="empty-state">
            <Icon name="search" size={28} />
            <p>No example matches these filters.</p>
            <button
              type="button"
              className="gix-button gix-button--secondary gix-button--sm"
              onClick={() => {
                setFramework(null);
                setCapability(null);
                setQuery('');
              }}
            >
              Clear filters
            </button>
          </div>
        ) : (
          <ul className="examples__grid">
            {results.map((example) => (
              <li key={example.dir} className="gix-card example-card">
                <div className="example-card__tags">
                  <span className="gix-badge">{example.framework}</span>
                  {example.capabilities.map((capabilityName) => (
                    <span key={capabilityName} className="gix-badge gix-badge--beta">
                      {capabilityName}
                    </span>
                  ))}
                </div>
                <h2>{example.title}</h2>
                <p>{example.description}</p>
                <div className="example-card__actions">
                  <Link href={example.guide} className="gix-button gix-button--secondary gix-button--sm">
                    Read the guide
                  </Link>
                  <a className="gix-button gix-button--ghost" href={`${SITE.github}/tree/${SITE.branch}/examples/${example.dir}`} target="_blank" rel="noreferrer">
                    <Icon name="github" size={14} /> Source
                  </a>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </SiteLayout>
  );
}

/* --------------------------------------------------------------------------- Enterprise */

const CONTROLS = [
  { title: 'Authentication', icon: 'lock', text: 'Identity and tenant come from your AuthenticationAdapter (or the reference JWT verifier), never from model text or request bodies.', href: '/docs/security' },
  { title: 'RBAC & ABAC', icon: 'users', text: 'Role-permission maps, requiredPermissions per tool and definePolicy attribute rules. Tool visibility is filtered too.', href: '/docs/security' },
  { title: 'Multi-tenancy', icon: 'building', text: 'Storage is reachable only through tenant-scoped handles; cross-tenant isolation is tested on real PostgreSQL.', href: '/docs/multi-tenancy' },
  { title: 'Usage & cost controls', icon: 'dollar', text: 'Quotas, budgets (warn, throttle, block, route cheaper), distributed rate limits and model routing with safe fallback.', href: '/docs/production/usage-and-cost' },
  { title: 'Observability', icon: 'activity', text: 'OpenTelemetry traces and metrics, Prometheus /metrics without tenant labels, structured JSON logs, redacted by default.', href: '/docs/production/observability' },
  { title: 'Secrets', icon: 'fingerprint', text: 'Environment or mounted-file secret providers; platform secrets are write-only and AES-256-GCM encrypted.', href: '/docs/production/configuration' },
] as const;

export function EnterprisePage() {
  return (
    <SiteLayout>
      <section className="page-hero gix-grid-bg">
        <div className="container">
          <span className="gix-eyebrow">Enterprise</span>
          <h1 tabIndex={-1}>
            AI with <GixGradientText>boundaries.</GixGradientText>
          </h1>
          <p>The model can request; it can never decide. Security is part of the runtime, not a wrapper around it.</p>
          <div className="hero__actions">
            <GixButton href="/docs/security" icon="arrowRight">
              Security overview
            </GixButton>
            <GixButton href="/docs/architecture" variant="secondary">
              Architecture
            </GixButton>
          </div>
        </div>
      </section>
      <section className="home-section" id="firewall" aria-labelledby="firewall-title">
        <div className="container split split--top">
          <GixSectionHeading eyebrow="AI Action Firewall" title="Every consequential action, checked." id="firewall-title">
            Authentication, permissions and attribute policies, schema, business rules, PII, rate limit, approval and audit run before a tool executes. A denial at any check means nothing runs.
          </GixSectionHeading>
          <FirewallPipeline denyAt={4} />
        </div>
      </section>
      <section className="home-section home-section--alt" id="approvals" aria-labelledby="approvals-title">
        <div className="container split split--top">
          <GixSectionHeading eyebrow="Human-in-the-loop" title="People approve what matters." id="approvals-title">
            Risk-based approvals up to two-person review. Decisions expire, are bound to tenant and requester, and are durable across instances with PostgreSQL. Text such as “the manager approved” changes nothing.
          </GixSectionHeading>
          <ApprovalCard />
        </div>
      </section>
      <section className="home-section" id="audit" aria-labelledby="audit-title">
        <div className="container split split--top">
          <GixSectionHeading eyebrow="Audit + PII" title="A record you can trust." id="audit-title">
            Audit is append-only: a database trigger rejects updates and deletes outside the retention purge, and it is kept separate from traces. Data policies redact fields before logging, telemetry and model context.
          </GixSectionHeading>
          <div id="pii">
            <TracePreview />
          </div>
        </div>
      </section>
      <section className="home-section home-section--alt" aria-labelledby="controls-title">
        <div className="container">
          <GixSectionHeading eyebrow="Controls" title="Built into the runtime." id="controls-title" />
          <CardGrid>
            {CONTROLS.map((control) => (
              <GixCard key={control.title} title={control.title} description={control.text} icon={control.icon} href={control.href} />
            ))}
          </CardGrid>
        </div>
      </section>
      <section className="cta gix-grid-bg" aria-labelledby="enterprise-cta">
        <div className="container cta__inner">
          <h2 id="enterprise-cta">
            Review the <GixGradientText>architecture.</GixGradientText>
          </h2>
          <div className="hero__actions">
            <GixButton href="/docs/architecture" icon="arrowRight">
              Architecture
            </GixButton>
            <GixButton href="/docs/production/security" variant="secondary">
              Production hardening
            </GixButton>
          </div>
        </div>
      </section>
    </SiteLayout>
  );
}

/* --------------------------------------------------------------------------- 404 */

/** Rendered once as 404.html and served for every unknown URL, so its text must not depend on the path. */
export function NotFoundPage() {
  const { open } = useSearch();
  return (
    <SiteLayout>
      <section className="not-found gix-grid-bg">
        <div className="container">
          <span className="gix-eyebrow">404</span>
          <h1 tabIndex={-1}>This page does not exist.</h1>
          <p>The link may be broken or the page may have moved. Search for it instead:</p>
          <div className="hero__actions">
            <button type="button" className="gix-button gix-button--primary" onClick={() => open()}>
              <Icon name="search" size={16} /> Search the docs
            </button>
            <GixButton href="/docs" variant="secondary">
              Documentation home
            </GixButton>
            <GixButton href="/" variant="ghost">
              Home
            </GixButton>
          </div>
        </div>
      </section>
    </SiteLayout>
  );
}
