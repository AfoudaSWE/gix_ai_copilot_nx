/** GIX-owned files `gix init` may create (§2, §12-13). Existing files are never overwritten. */

export const SERVER_FILE = 'gix/server.ts';

/** Local ESM boundaries, without changing the existing application's package.json. */
export const MODULE_PACKAGE = '{\n  "private": true,\n  "type": "module"\n}\n';

export function serverSource(projectName: string): string {
  return `// Created by \`gix init\`. GIX-owned: the copilot server for ${projectName}. Edit freely;
// \`gix init\` never overwrites it. Run it with \`npx gix dev\`.
import {
  attachStudio,
  createActionFirewall,
  createCopilot,
  createInMemoryAuditSink,
  createMockProvider,
  createOpenAIProvider,
  createToolRegistry,
  loadGeneratedTools,
} from '@gixcopilot/sdk/server';

const root = process.cwd();
const apiKey = process.env['OPENAI_API_KEY'];

// Tools you approved and applied in the Developer Studio (.gix/tools). Each one still passes the
// Action Firewall with the risk, permission and approval it was approved with.
const tools = createToolRegistry();
const loaded = await loadGeneratedTools(tools, { root, baseUrl: process.env['GIX_API_BASE_URL'], log: console.warn });

const copilot = createCopilot({
  // The model key stays on this server. The browser never sees it.
  model: apiKey ? { provider: 'openai', model: process.env['OPENAI_MODEL'] ?? 'gpt-4o-mini' } : { provider: 'mock', model: 'gix-development' },
  providers: apiKey
    ? [createOpenAIProvider({ apiKey })]
    : [createMockProvider({ id: 'mock', scenario: { chunks: ['GIX development model (mock). Put OPENAI_API_KEY in .env for real answers.'] } })],
  tools,
  security: { firewall: createActionFirewall({ audit: createInMemoryAuditSink() }) },
});

// The Developer Studio at /__gix: development only; never loaded in production.
await attachStudio(copilot, { root });

const port = Number(process.env['GIX_PORT'] ?? 4000);
const address = await copilot.listen({ port });
console.log(\`GIX copilot on \${address} (\${String(loaded.registered.length)} approved tool(s))\`);
if (process.env['NODE_ENV'] !== 'production') console.log(\`Developer Studio: http://localhost:\${String(port)}/__gix\`);
`;
}

export const ENV_EXAMPLE = `# Copy to .env at the project root. Server-only: never expose these to a frontend.
OPENAI_API_KEY=
OPENAI_MODEL=
# Base URL of your API, used by generated API tools.
GIX_API_BASE_URL=
GIX_PORT=4000
`;

/** Proposals are local review state, not source. */
export const GIX_GITIGNORE = 'proposals/\ndiscovery.json\n';
