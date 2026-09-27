import type { IconName } from '../design/icons.js';
import { SITE } from '../site.js';

/** Website navigation. Every item points at a real page (docs, website section or repository). */
export interface MenuItem {
  readonly label: string;
  readonly description: string;
  readonly href: string;
  readonly icon: IconName;
}

export interface Menu {
  readonly label: string;
  readonly items: readonly MenuItem[];
}

export const MENUS: readonly Menu[] = [
  {
    label: 'Product',
    items: [
      { label: 'AI Copilot', description: 'Streaming chat that knows your application', href: '/docs/concepts', icon: 'chat' },
      { label: 'Agents', description: 'Specialists, delegation, handoff and planning', href: '/docs/agents', icon: 'bot' },
      { label: 'Tools', description: 'Typed, permission-aware application actions', href: '/docs/tools', icon: 'tool' },
      { label: 'Generative UI', description: 'Your trusted components, chosen by the model', href: '/docs/generative-ui', icon: 'layout' },
      { label: 'Application Context', description: 'Page, user and state the model may see', href: '/docs/context', icon: 'eye' },
      { label: 'RAG', description: 'Knowledge with tenant and ACL filtering', href: '/docs/rag', icon: 'database' },
      { label: 'Memory', description: 'Owner-scoped, explicit, expiring memory', href: '/docs/memory', icon: 'memory' },
      { label: 'Workflows', description: 'Durable steps, approvals and compensation', href: '/docs/workflows', icon: 'workflow' },
      { label: 'Security', description: 'The AI Action Firewall on every tool call', href: '/docs/security', icon: 'shield' },
      { label: 'Observability', description: 'Traces, events, tokens and DevTools', href: '/docs/devtools', icon: 'activity' },
    ],
  },
  {
    label: 'Developers',
    items: [
      { label: 'Documentation', description: 'Guides, concepts and reference', href: '/docs', icon: 'book' },
      { label: 'Quickstart', description: 'A streaming copilot in minutes', href: '/docs/quickstart', icon: 'rocket' },
      { label: 'React', description: 'Provider, hooks and chat UI', href: '/docs/react', icon: 'layers' },
      { label: 'Vue', description: 'Plugin, composables and chat component', href: '/docs/vue', icon: 'layers' },
      { label: 'Angular', description: 'Signals, DI and OnPush components', href: '/docs/angular', icon: 'layers' },
      { label: 'Node.js', description: 'The copilot server', href: '/docs/node', icon: 'node' },
      { label: 'Next.js', description: 'Copilot API in a route handler', href: '/docs/nextjs', icon: 'node' },
      { label: 'Examples', description: 'Runnable example applications', href: '/examples', icon: 'code' },
      { label: 'API Reference', description: 'Every public export, with signatures', href: '/docs/api', icon: 'api' },
      { label: 'CLI', description: 'Scaffold, import, evaluate, diagnose', href: '/docs/cli', icon: 'terminal' },
      { label: 'Connect Any API', description: 'Any REST or GraphQL API, any language', href: '/docs/connectors', icon: 'plug' },
      { label: 'OpenAPI', description: 'Turn APIs into allowlisted tools', href: '/docs/openapi', icon: 'plug' },
      { label: 'MCP', description: 'Model Context Protocol servers, deny by default', href: '/docs/mcp', icon: 'plug' },
    ],
  },
  {
    label: 'Enterprise',
    items: [
      { label: 'AI Action Firewall', description: 'Every consequential action, checked', href: '/enterprise#firewall', icon: 'shieldCheck' },
      { label: 'RBAC & ABAC', description: 'Roles, permissions and attribute policies', href: '/docs/security', icon: 'users' },
      { label: 'Human-in-the-Loop', description: 'Approvals up to two-person review', href: '/enterprise#approvals', icon: 'handshake' },
      { label: 'Audit', description: 'Append-only, separate from traces', href: '/enterprise#audit', icon: 'audit' },
      { label: 'Multi-Tenancy', description: 'Tenant from authentication only', href: '/docs/multi-tenancy', icon: 'building' },
      { label: 'PII Protection', description: 'Redaction before logs, traces and models', href: '/enterprise#pii', icon: 'fingerprint' },
      { label: 'Observability', description: 'OpenTelemetry, metrics, structured logs', href: '/docs/production/observability', icon: 'activity' },
      { label: 'Usage & Cost Controls', description: 'Quotas, budgets and rate limits', href: '/docs/production/usage-and-cost', icon: 'dollar' },
    ],
  },
  {
    label: 'Resources',
    items: [
      { label: 'Architecture', description: 'How the packages fit together', href: '/docs/architecture', icon: 'layers' },
      { label: 'Examples', description: 'React, Angular and Node examples', href: '/examples', icon: 'code' },
      { label: 'Roadmap', description: 'What is done and what is next', href: '/docs/roadmap', icon: 'rocket' },
      { label: 'Versioning', description: 'SemVer, deprecation and migrations', href: '/docs/versioning', icon: 'book' },
      { label: 'GitHub', description: 'Source, issues and releases', href: SITE.github, icon: 'github' },
      { label: 'npm', description: 'The @gixcopilot packages', href: SITE.npm, icon: 'external' },
    ],
  },
];

export const FOOTER: readonly { readonly title: string; readonly links: readonly { readonly label: string; readonly href: string }[] }[] = [
  {
    title: 'Product',
    links: [
      { label: 'Copilot', href: '/docs/concepts' },
      { label: 'Agents', href: '/docs/agents' },
      { label: 'Generative UI', href: '/docs/generative-ui' },
      { label: 'Workflows', href: '/docs/workflows' },
      { label: 'Security', href: '/enterprise' },
    ],
  },
  {
    title: 'Developers',
    links: [
      { label: 'Documentation', href: '/docs' },
      { label: 'API Reference', href: '/docs/api' },
      { label: 'React', href: '/docs/react' },
      { label: 'Vue', href: '/docs/vue' },
      { label: 'Angular', href: '/docs/angular' },
      { label: 'Node.js', href: '/docs/node' },
      { label: 'Examples', href: '/examples' },
    ],
  },
  {
    title: 'Integrations',
    links: [
      { label: 'Any REST / GraphQL API', href: '/docs/connectors' },
      { label: 'OpenAPI', href: '/docs/openapi' },
      { label: 'MCP', href: '/docs/mcp' },
      { label: 'Model providers', href: '/docs/models' },
      { label: 'PostgreSQL', href: '/docs/production/database' },
    ],
  },
  {
    title: 'Resources',
    links: [
      { label: 'Architecture', href: '/docs/architecture' },
      { label: 'Security', href: '/docs/security' },
      { label: 'Roadmap', href: '/docs/roadmap' },
      { label: 'GitHub', href: SITE.github },
      { label: 'npm', href: SITE.npm },
    ],
  },
  { title: 'GIX', links: [{ label: 'GIX Technology', href: SITE.company.url }] },
];
