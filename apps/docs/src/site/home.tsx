import angularMain from '../../snippets/angular-main.ts?raw';
import generativeUi from '../../snippets/generative-ui.tsx?raw';
import nodeServer from '../../snippets/node-server.ts?raw';
import reactApp from '../../snippets/react-app.tsx?raw';
import reactContext from '../../snippets/react-context.tsx?raw';
import secureServer from '../../snippets/secure-server.ts?raw';
import toolSnippet from '../../snippets/tool.ts?raw';
import vueMain from '../../snippets/vue-main.ts?raw';
import { Accordion, CardGrid, GixButton, GixCard, GixGradientText, GixSectionHeading } from '../design/components.js';
import { CodeBlock, CodeTabs, InstallerCommand, Terminal } from '../design/code.js';
import { Icon } from '../design/icons.js';
import type { IconName } from '../design/icons.js';
import type { ReactNode } from 'react';
import { Link } from '../router.js';
import { ApprovalCard, ArchitectureExplorer, DevToolsPreview, FirewallPipeline, HeroDemo, TracePreview, WorkflowStepper } from './demos.js';
import { SiteLayout } from './chrome.js';

/** Only integrations the repository actually ships. */
const STRIP: readonly { readonly label: string; readonly note?: string }[] = [
  { label: 'React' },
  { label: 'Vue' },
  { label: 'Angular' },
  { label: 'Node.js' },
  { label: 'OpenAI', note: 'provider' },
  { label: 'Any REST / GraphQL API' },
  { label: 'OpenAPI' },
  { label: 'MCP' },
  { label: 'PostgreSQL + pgvector' },
  { label: 'Redis + BullMQ' },
  { label: 'OpenTelemetry' },
];

const PILLARS: readonly { readonly title: string; readonly text: string; readonly icon: IconName; readonly href: string }[] = [
  { title: 'Application Context', text: 'Your AI understands the current page, user, selection and state: only what you register, within a token budget.', icon: 'eye', href: '/docs/context' },
  { title: 'Tools', text: 'Let AI call real application capabilities through typed, schema-validated, permission-aware tools.', icon: 'tool', href: '/docs/tools' },
  { title: 'Generative UI', text: 'Turn structured AI output into your own trusted, interactive components.', icon: 'layout', href: '/docs/generative-ui' },
  { title: 'RAG', text: 'Connect enterprise knowledge with tenant and ACL filtering before any text reaches the model.', icon: 'database', href: '/docs/rag' },
  { title: 'Agents', text: 'Create specialist and orchestrator agents that never exceed their caller’s privileges.', icon: 'bot', href: '/docs/agents' },
  { title: 'Workflows', text: 'Run durable, checkpointed, multi-step AI operations with approvals and compensation.', icon: 'workflow', href: '/docs/workflows' },
];

const DIFFERENTIATORS: readonly [string, IconName, string][] = [
  ['Framework independent', 'layers', 'One headless core; React, Vue, Angular and Node adapters on top.'],
  ['Application context', 'eye', 'Scoped, prioritized, budgeted, sensitivity-aware.'],
  ['Permission-aware tools', 'tool', 'Risk classes; unclassified tools fail closed.'],
  ['AI Action Firewall', 'shieldCheck', 'Every consequential call checked and audited.'],
  ['Generative UI', 'layout', 'Registered components, validated props, no generated code.'],
  ['OpenAPI + MCP', 'plug', 'Allowlisted, deny by default, same firewall.'],
  ['Permission-aware RAG', 'database', 'Tenant + ACL filtering before retrieval.'],
  ['Durable workflows', 'workflow', 'Checkpoints, approvals, retries, compensation.'],
  ['DevTools', 'activity', 'Inspect context, tools, RAG, agents and events.'],
  ['Evaluations', 'flask', 'Datasets, CI gates and security hard gates.'],
  ['Multi-tenancy', 'building', 'Tenant from authentication, tenant-scoped storage.'],
  ['Cost controls', 'dollar', 'Quotas, budgets, rate limits, model routing.'],
];

function Section({ id, className = '', children }: { readonly id: string; readonly className?: string; readonly children: ReactNode }) {
  return (
    <section id={id} className={`home-section ${className}`} aria-labelledby={`${id}-title`}>
      <div className="container">{children}</div>
    </section>
  );
}

function Flow({ steps, label }: { readonly steps: readonly string[]; readonly label: string }) {
  return (
    <ol className="flow" aria-label={label}>
      {steps.map((step, index) => (
        <li key={`${index}-${step}`} className={index === steps.length - 1 ? 'flow__last' : undefined}>
          {step}
        </li>
      ))}
    </ol>
  );
}

export function HomePage() {
  return (
    <SiteLayout>
      {/* ---------------------------------------------------------------- Hero */}
      <section className="hero gix-grid-bg" aria-labelledby="hero-title">
        <div className="hero__glow" aria-hidden="true" />
        <div className="container hero__inner">
          <div className="hero__copy">
            <Link href="/docs/installation" className="hero__announce">
              <span className="gix-badge gix-badge--accent">New</span> One-command install for React, Vue and Angular <Icon name="arrowRight" size={14} />
            </Link>
            <h1 id="hero-title" className="hero__title">
              Build AI
              <br />
              that understands
              <br />
              <GixGradientText>your application.</GixGradientText>
            </h1>
            <p className="hero__lead">GIX AI is an enterprise SDK for building application-aware copilots and agents with tools, context, RAG, generative UI, workflows and built-in security.</p>
            <div className="hero__actions">
              <GixButton href="/docs/quickstart" icon="arrowRight">
                Get Started
              </GixButton>
              <GixButton href="/docs" variant="secondary">
                Read the Docs
              </GixButton>
            </div>
            <div className="hero__install">
              <CodeBlock code="npm create @gixcopilot@latest" language="bash" title="Terminal" />
            </div>
          </div>
          <HeroDemo />
        </div>
      </section>

      {/* ---------------------------------------------------------------- Framework strip */}
      <section className="strip" aria-label="Frameworks and integrations">
        <div className="container">
          <p className="strip__title">Works with the stack you already run</p>
          <ul className="strip__list">
            {STRIP.map((item) => (
              <li key={item.label}>
                {item.label}
                {item.note && <span>{item.note}</span>}
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ---------------------------------------------------------------- More than a chatbot */}
      <Section id="capabilities">
        <GixSectionHeading eyebrow="Capabilities" title="Build more than a chatbot" id="capabilities-title">
          A copilot that sees the application, acts through it, renders its UI and knows where its boundaries are.
        </GixSectionHeading>
        <CardGrid columns={3}>
          {PILLARS.map((pillar) => (
            <GixCard key={pillar.title} title={pillar.title} description={pillar.text} icon={pillar.icon} href={pillar.href} />
          ))}
        </CardGrid>
      </Section>

      {/* ---------------------------------------------------------------- Architecture */}
      <Section id="architecture" className="home-section--alt">
        <GixSectionHeading eyebrow="Architecture" title="One runtime. Clear boundaries." id="architecture-title">
          Select a component to see its role. The model reasons; the runtime and your policies decide what happens.
        </GixSectionHeading>
        <ArchitectureExplorer />
      </Section>

      {/* ---------------------------------------------------------------- Context + tools */}
      <Section id="tools">
        <div className="split">
          <div>
            <GixSectionHeading eyebrow="Application awareness + Tools" title="Context in. Actions out." id="tools-title">
              Pages register what the model may know. Tools are typed capabilities with a declared risk; every call is validated and checked before it runs.
            </GixSectionHeading>
            <Flow label="Tool lifecycle" steps={['AI', 'Tool request', 'Validation', 'Security', 'Execution', 'Result', 'AI']} />
            <p className="split__more">
              <Link href="/docs/tools">Tools guide →</Link> · <Link href="/docs/context">Context guide →</Link>
            </p>
          </div>
          <CodeTabs
            label="Context and tools"
            tabs={[
              { label: 'Tool', code: toolSnippet, language: 'ts', title: 'tool.ts' },
              { label: 'Context', code: reactContext, language: 'tsx', title: 'ApplicationPage.tsx' },
              { label: 'Secure server', code: secureServer, language: 'ts', title: 'server.ts' },
            ]}
          />
        </div>
      </Section>

      {/* ---------------------------------------------------------------- Generative UI */}
      <Section id="generative-ui" className="home-section--alt">
        <GixSectionHeading eyebrow="Generative UI" title="AI that builds the right interface." id="generative-ui-title">
          The model selects components you registered and supplies props that must pass their schema. It never generates executable application code.
        </GixSectionHeading>
        <div className="genui">
          <div className="genui__step">
            <span className="genui__label">1 · User</span>
            <div className="bubble bubble--user">Show APP-1024</div>
          </div>
          <Icon name="arrowRight" className="genui__arrow" />
          <div className="genui__step">
            <span className="genui__label">2 · Structured request</span>
            <CodeBlock chrome={false} language="json" code={`{\n  "component": "ApplicationCard",\n  "props": {\n    "applicationId": "APP-1024",\n    "status": "Under review"\n  }\n}`} />
          </div>
          <Icon name="arrowRight" className="genui__arrow" />
          <div className="genui__step">
            <span className="genui__label">3 · Validated, your component</span>
            <div className="gen-card">
              <div className="gen-card__head">
                <strong>APP-1024</strong>
                <span className="gix-badge gix-badge--beta">Under review</span>
              </div>
              <span className="gix-button gix-button--secondary gix-button--sm" aria-hidden="true">
                Open application
              </span>
            </div>
          </div>
        </div>
        <Flow label="Generative UI pipeline" steps={['Model', 'Structured UI request', 'Schema validation', 'Trusted component registry', 'Application UI']} />
        <CodeBlock code={generativeUi} language="tsx" title="TrustedComponents.tsx" />
      </Section>

      {/* ---------------------------------------------------------------- OpenAPI + MCP */}
      <Section id="integrations">
        <GixSectionHeading eyebrow="Integrations" title="Turn APIs into AI capabilities." id="integrations-title">
          Connect any REST or GraphQL API, in any language or framework, with or without an OpenAPI document, and serve it to other AI clients as an MCP server. Nothing is exposed until you allow it, and every tool goes through the same Action Firewall.
        </GixSectionHeading>
        <div className="split split--three split--top">
          <div className="integration">
            <h3>
              <Icon name="plug" /> Any API
            </h3>
            <Flow label="Connect any API" steps={['Your API (any stack)', 'Declared endpoints', 'Typed tools', 'Action Firewall', 'Copilot + MCP']} />
            <CodeBlock code={'npx aicopilot add api crm --url https://crm.example.com\nnpx aicopilot api check apis/crm.api.yaml\nnpx aicopilot mcp serve apis/crm.api.yaml'} language="bash" />
            <p>
              Laravel, Django, Spring, .NET, Rails, Go or Express: describe endpoints in TypeScript or a YAML manifest. <Link href="/docs/connectors">Connect any API →</Link>
            </p>
          </div>
          <div className="integration">
            <h3>
              <Icon name="plug" /> OpenAPI
            </h3>
            <Flow label="OpenAPI import" steps={['openapi.yaml', 'aicopilot import-openapi', 'Allowlisted tools', 'Action Firewall', 'AI agent']} />
            <CodeBlock code="npx aicopilot import-openapi ./openapi.yaml --id visa-api" language="bash" />
            <p>Every operation starts disabled; mutating methods require approval by default.</p>
          </div>
          <div className="integration">
            <h3>
              <Icon name="plug" /> MCP
            </h3>
            <div className="mcp-tree" aria-label="MCP in the runtime">
              <code>GIX AI runtime</code>
              <ul>
                <li>Native tools</li>
                <li>OpenAPI tools</li>
                <li>
                  MCP servers <span>stdio · streamable HTTP</span>
                  <ul>
                    <li>Tools</li>
                    <li>Resources</li>
                    <li>Prompts</li>
                  </ul>
                </li>
              </ul>
            </div>
            <CodeBlock code={'npx aicopilot add mcp files --url https://mcp.example.com/mcp'} language="bash" />
            <p>Deny by default. Credentials stay on the server; trust levels are diagnostic, never a bypass.</p>
          </div>
        </div>
      </Section>

      {/* ---------------------------------------------------------------- RAG + memory */}
      <Section id="rag" className="home-section--alt">
        <div className="split">
          <div>
            <GixSectionHeading eyebrow="Knowledge + Memory" title="Knowledge that respects permissions." id="rag-title">
              Loaders for text, Markdown, HTML, PDF, DOCX, web, APIs, databases and object storage. Retrieval filters by the caller’s tenant and ACL before anything reaches the model, and answers carry citations.
            </GixSectionHeading>
            <p>
              Memory is explicit and owner-scoped: every read and write checks owner and tenant, entries expire, and secrets are rejected. <Link href="/docs/memory">Memory guide →</Link>
            </p>
          </div>
          <Flow label="RAG pipeline" steps={['Load', 'Parse', 'Chunk', 'Embed', 'pgvector', 'Tenant + ACL filter', 'Rerank', 'Context + citations', 'LLM']} />
        </div>
      </Section>

      {/* ---------------------------------------------------------------- Agents + workflows */}
      <Section id="agents">
        <GixSectionHeading eyebrow="Agents + Workflows" title="From copilot to agentic systems." id="agents-title">
          Orchestrators delegate to specialists on the same runtime and firewall. Delegation intersects tools, knowledge and memory with the caller’s ceiling, so no agent gains authority its caller lacks.
        </GixSectionHeading>
        <div className="split">
          <div className="agents-tree" role="img" aria-label="An orchestrator agent delegating to research, support and application agents, which use tools">
            <div className="agents-tree__node agents-tree__node--root">Orchestrator</div>
            <div className="agents-tree__row">
              <div className="agents-tree__node">Research agent</div>
              <div className="agents-tree__node">Support agent</div>
              <div className="agents-tree__node">Application agent</div>
            </div>
            <div className="agents-tree__node agents-tree__node--tools">Tools · behind the Action Firewall</div>
          </div>
          <div>
            <h3 className="subhead">Durable workflows</h3>
            <WorkflowStepper />
          </div>
        </div>
      </Section>

      {/* ---------------------------------------------------------------- Security */}
      <section id="security" className="home-section security-section" aria-labelledby="security-title">
        <div className="container">
          <div className="security-statement">
            <p className="security-statement__small">AI can reason.</p>
            <h2 id="security-title">
              Your application
              <br />
              decides what it
              <br />
              <GixGradientText>can do.</GixGradientText>
            </h2>
            <p>Model output is data, not authority. Every consequential tool call passes the AI Action Firewall, and the decision is audited.</p>
            <GixButton href="/enterprise" variant="secondary" icon="arrowRight">
              Enterprise security
            </GixButton>
          </div>
          <div className="split split--top">
            <FirewallPipeline />
            <ApprovalCard />
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------------- DevTools + observability */}
      <Section id="devtools">
        <GixSectionHeading eyebrow="DevTools + Evals + Observability" title="Understand what your AI is doing." id="devtools-title">
          Inspect conversations, context budgets, tool decisions, RAG candidates, agent trees and events. Export traces through OpenTelemetry and gate releases with evaluations.
        </GixSectionHeading>
        <div className="split split--top">
          <DevToolsPreview />
          <TracePreview />
        </div>
      </Section>

      {/* ---------------------------------------------------------------- Frameworks */}
      <Section id="frameworks" className="home-section--alt">
        <GixSectionHeading eyebrow="Frameworks" title="Your framework. Same core." id="frameworks-title">
          React, Vue and Angular adapters share one headless chat store; the Node server owns models, tools and security.
        </GixSectionHeading>
        <CodeTabs
          label="Framework examples"
          tabs={[
            { label: 'React', code: reactApp, language: 'tsx', title: 'main.tsx' },
            { label: 'Vue', code: vueMain, language: 'ts', title: 'main.ts' },
            { label: 'Angular', code: angularMain, language: 'ts', title: 'main.ts' },
            { label: 'Node', code: nodeServer, language: 'ts', title: 'server.ts' },
          ]}
        />
      </Section>

      {/* ---------------------------------------------------------------- Built for real apps */}
      <Section id="production">
        <GixSectionHeading eyebrow="Production" title="Built for real applications." id="production-title">
          PostgreSQL persistence, Redis workers, model routing with safe fallback, usage budgets, multi-tenancy, Docker images and a management platform.
        </GixSectionHeading>
        <ul className="diff-grid">
          {DIFFERENTIATORS.map(([title, icon, text]) => (
            <li key={title}>
              <Icon name={icon} />
              <strong>{title}</strong>
              <span>{text}</span>
            </li>
          ))}
        </ul>
      </Section>

      {/* ---------------------------------------------------------------- Quickstart */}
      <Section id="quickstart" className="home-section--alt">
        <GixSectionHeading eyebrow="Quickstart" title="From zero to copilot." id="quickstart-title">
          One command adds everything to your app, or follow the steps to wire it yourself.
        </GixSectionHeading>
        <div className="split split--top">
          <Accordion
            items={[
              { title: '01 · Install', open: true, content: <InstallerCommand /> },
              { title: '02 · Configure', content: <CodeBlock code={'# copilot-server/.env (never in the browser)\nOPENAI_API_KEY=sk-...\nOPENAI_MODEL=gpt-4o-mini'} language="bash" title=".env" /> },
              { title: '03 · Add server', content: <CodeBlock code={nodeServer} language="ts" title="server.ts" /> },
              { title: '04 · Add UI', content: <CodeBlock code={reactApp} language="tsx" title="main.tsx" /> },
              { title: '05 · Add context', content: <CodeBlock code={reactContext} language="tsx" title="ApplicationPage.tsx" /> },
              { title: '06 · Add tools', content: <CodeBlock code={toolSnippet} language="ts" title="tool.ts" /> },
              {
                title: '07 · Run',
                content: <CodeBlock code={'npm run copilot:server   # http://127.0.0.1:4000\nnpm run dev'} language="bash" />,
              },
            ]}
          />
          <Terminal
            title="npm create @gixcopilot"
            lines={[
              { kind: 'command', text: 'npm create @gixcopilot@latest' },
              { kind: 'output', text: '? Detected React in my-shop. Add the React copilot? Yes' },
              { kind: 'output', text: '? Add a Node copilot server? Yes' },
              { kind: 'success', text: 'Install @gixcopilot/react, @gixcopilot/ui' },
              { kind: 'success', text: 'Add src/copilot/CopilotPanel.tsx' },
              { kind: 'success', text: 'Proxy /api/copilot (vite.config.ts)' },
              { kind: 'success', text: 'Create the Node copilot server in copilot-server/' },
              { kind: 'output', text: 'Copilot added.' },
              { kind: 'command', text: 'npm run copilot:server' },
            ]}
          />
        </div>
      </Section>

      {/* ---------------------------------------------------------------- Developer-first */}
      <section className="manifesto" aria-label="Developer principles">
        <div className="container">
          <p>
            Your app. <span>Your components.</span> Your tools. <span>Your data.</span> <GixGradientText>Your rules.</GixGradientText>
          </p>
        </div>
      </section>

      {/* ---------------------------------------------------------------- CTA */}
      <section className="cta gix-grid-bg" aria-labelledby="cta-title">
        <div className="container cta__inner">
          <h2 id="cta-title">
            Build your first
            <br />
            <GixGradientText>AI copilot.</GixGradientText>
          </h2>
          <div className="hero__actions">
            <GixButton href="/docs/quickstart" icon="arrowRight">
              Get Started
            </GixButton>
            <GixButton href="/docs" variant="secondary">
              Read Documentation
            </GixButton>
          </div>
        </div>
      </section>
    </SiteLayout>
  );
}
