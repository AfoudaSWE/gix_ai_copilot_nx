import type { PlannedFile } from './files.js';

export type Template = 'node' | 'react' | 'angular' | 'enterprise';
export const TEMPLATES: readonly Template[] = ['node', 'react', 'angular', 'enterprise'];

export interface TemplateOptions {
  readonly name: string;
  readonly template: Template;
  /** Version range for @gixcopilot packages (default ^0.2.0; keep in step with package.json). */
  readonly sdkVersion?: string;
  /** Local tarballs (`pnpm pack` output) to install instead of the registry: package -> file: spec. */
  readonly sdkTarballs?: Readonly<Record<string, string>>;
}

const TOOLCHAIN = { typescript: '5.9.3', '@types/node': '22.20.3', vitest: '5.0.1', zod: '4.6.5', react: '19.3.0', '@types/react': '19.3.0', '@types/react-dom': '19.3.0', vite: '8.3.0', angular: '21.2.24', rxjs: '7.8.2' } as const;

function sdk(options: TemplateOptions, name: string): string {
  return options.sdkTarballs?.[`@gixcopilot/${name}`] ?? options.sdkVersion ?? '^0.2.0';
}

function packageJson(options: TemplateOptions, extra: { scripts: Record<string, string>; sdk: string[]; dependencies?: Record<string, string>; devDependencies?: Record<string, string> }): string {
  const dependencies: Record<string, string> = { zod: TOOLCHAIN.zod, ...extra.dependencies };
  for (const name of extra.sdk) dependencies[`@gixcopilot/${name}`] = sdk(options, name);
  const pkg: Record<string, unknown> = {
    name: options.name,
    version: '0.1.0',
    private: true,
    type: 'module',
    scripts: extra.scripts,
    dependencies: Object.fromEntries(Object.entries(dependencies).sort(([a], [b]) => a.localeCompare(b))),
    devDependencies: Object.fromEntries(Object.entries({ typescript: TOOLCHAIN.typescript, '@types/node': TOOLCHAIN['@types/node'], vitest: TOOLCHAIN.vitest, ...extra.devDependencies }).sort(([a], [b]) => a.localeCompare(b))),
    engines: { node: '>=22.12.0' },
  };
  // Local tarballs: transitive @gixcopilot packages must resolve to tarballs too.
  if (options.sdkTarballs && Object.keys(options.sdkTarballs).length > 0) {
    pkg['pnpm'] = { overrides: options.sdkTarballs };
    pkg['overrides'] = options.sdkTarballs;
  }
  return `${JSON.stringify(pkg, null, 2)}\n`;
}

const TSCONFIG_SERVER = `${JSON.stringify(
  {
    compilerOptions: {
      target: 'ES2022',
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
      strict: true,
      noUncheckedIndexedAccess: true,
      skipLibCheck: true,
      outDir: 'dist',
      rootDir: 'src',
      types: ['node'],
      verbatimModuleSyntax: true,
    },
    include: ['src/**/*.ts'],
    exclude: ['src/**/*.spec.ts', 'src/web/**', 'src/app/**'],
  },
  null,
  2,
)}\n`;

const ENV_EXAMPLE = `# Copy to .env and fill in. Never commit .env.
# Model provider (the browser never sees this key).
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4o-mini
PORT=4000
`;

const GITIGNORE = `node_modules/
dist/
web-dist/
.angular/
.env
.env.*
!.env.example
coverage/
`;

const CONFIG = `${JSON.stringify({ service: { name: 'copilot-app', port: 4000 }, telemetry: { mode: 'redacted' }, features: {} }, null, 2)}\n`;

const TOOLS_INDEX = `import type { AnyToolDefinition } from '@gixcopilot/tools';

// \`aicopilot add tool <name>\` appends exports here.
export const tools: AnyToolDefinition[] = [];
`;

const AGENTS_INDEX = `import type { AnyAgentDefinition } from '@gixcopilot/agents';

// \`aicopilot add agent <name>\` appends exports here.
export const agents: AnyAgentDefinition[] = [];
`;

function serverSource(options: { readonly web: boolean }): string {
  return `import { createCopilot } from '@gixcopilot/node';
import { createMockProvider } from '@gixcopilot/provider-mock';
import { createOpenAIProvider } from '@gixcopilot/provider-openai';
import { createActionFirewall, createInMemoryAuditSink } from '@gixcopilot/security';
import { tools } from './tools/index.js';

/**
 * The copilot server. The model provider runs here, never in the browser. Without
 * OPENAI_API_KEY it uses a clearly labelled development mock.
 */
export function createApp(env: NodeJS.ProcessEnv = process.env) {
  const apiKey = env['OPENAI_API_KEY'];
  return createCopilot({
    model: apiKey ? { provider: 'openai', model: env['OPENAI_MODEL'] ?? 'gpt-4o-mini' } : { provider: 'mock', model: 'dev' },
    providers: apiKey
      ? [createOpenAIProvider({ apiKey })]
      : [createMockProvider({ id: 'mock', scenario: { chunks: ['Hello from the development mock provider. Set OPENAI_API_KEY for real answers.'] } })],
    tools,
    // Every backend tool call passes the Action Firewall; audit goes to a durable sink in production.
    security: { firewall: createActionFirewall({ audit: createInMemoryAuditSink() }) },
  });
}

if (process.argv[1]?.endsWith('server.js')) {
  const copilot = createApp();
  const port = Number(process.env['PORT'] ?? 4000);
  await copilot.listen({ host: '127.0.0.1', port });
  console.log(\`Copilot server on http://127.0.0.1:\${port}${options.web ? ' (the web app proxies /api/copilot here)' : ''}\`);
}
`;
}

const SERVER_SPEC = `import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from './server.js';

const apps: ReturnType<typeof createApp>[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe('copilot server', () => {
  it('answers with the development mock provider', async () => {
    const copilot = createApp({});
    apps.push(copilot);
    const result = await copilot.run('Hello');
    expect(result.status).toBe('completed');
    expect(result.text).toContain('mock provider');
  });
});
`;

function readme(options: TemplateOptions, extra: string): string {
  return `# ${options.name}

Generated by \`aicopilot init --template ${options.template}\`.

\`\`\`sh
cp .env.example .env   # add OPENAI_API_KEY for real answers
npm install            # npm 11+ or pnpm (npm 10.9 cannot resolve Vitest's dependency tree)
npm run build
npm test
${extra}\`\`\`

Next steps: \`npx aicopilot add tool applications-get\`, \`npx aicopilot add agent support\`,
\`npx aicopilot doctor\`. Every tool declares its risk; unclassified tools are held for approval.
`;
}

function nodeFiles(_options: TemplateOptions, web: boolean): PlannedFile[] {
  return [
    { path: 'tsconfig.json', content: TSCONFIG_SERVER },
    { path: '.env.example', content: ENV_EXAMPLE },
    { path: '.gitignore', content: GITIGNORE },
    { path: 'aicopilot.config.json', content: CONFIG },
    { path: 'vitest.config.ts', content: `import { defineConfig } from 'vitest/config';\n\nexport default defineConfig({ test: { include: ['src/**/*.spec.ts'] } });\n` },
    { path: 'src/server.ts', content: serverSource({ web }) },
    { path: 'src/server.spec.ts', content: SERVER_SPEC },
    { path: 'src/tools/index.ts', content: TOOLS_INDEX },
    { path: 'src/agents/index.ts', content: AGENTS_INDEX },
  ];
}

const NODE_SDK = ['node', 'provider-mock', 'provider-openai', 'security', 'tools', 'agents'];

function reactFiles(options: TemplateOptions): PlannedFile[] {
  return [
    ...nodeFiles(options, true),
    {
      path: 'package.json',
      content: packageJson(options, {
        scripts: { build: 'tsc -p tsconfig.json && tsc -p tsconfig.web.json && vite build', typecheck: 'tsc -p tsconfig.json --noEmit && tsc -p tsconfig.web.json', test: 'vitest run', start: 'node --env-file-if-exists=.env dist/server.js', dev: 'vite' },
        sdk: [...NODE_SDK, 'react', 'ui'],
        dependencies: { react: TOOLCHAIN.react, 'react-dom': TOOLCHAIN.react },
        devDependencies: { vite: TOOLCHAIN.vite, '@types/react': TOOLCHAIN['@types/react'], '@types/react-dom': TOOLCHAIN['@types/react-dom'] },
      }),
    },
    {
      path: 'tsconfig.web.json',
      content: `${JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler', jsx: 'react-jsx', strict: true, skipLibCheck: true, noEmit: true, lib: ['ES2023', 'DOM', 'DOM.Iterable'], types: [] }, include: ['src/web/**/*.ts', 'src/web/**/*.tsx'] }, null, 2)}\n`,
    },
    { path: 'index.html', content: `<!doctype html>\n<html lang="en">\n  <head>\n    <meta charset="UTF-8" />\n    <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n    <title>${options.name}</title>\n  </head>\n  <body>\n    <div id="root"></div>\n    <script type="module" src="/src/web/main.tsx"></script>\n  </body>\n</html>\n` },
    { path: 'vite.config.ts', content: `import { defineConfig } from 'vite';\n\n// /api/copilot is proxied to the copilot server (npm start) so the browser never needs a provider key.\nexport default defineConfig({\n  server: { proxy: { '/api/copilot': { target: 'http://127.0.0.1:4000', rewrite: (path) => path.replace(/^\\/api\\/copilot/, '') } } },\n  build: { outDir: 'web-dist' },\n});\n` },
    {
      path: 'src/web/main.tsx',
      content: `import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { CopilotProvider } from '@gixcopilot/react';
import { CopilotChat } from '@gixcopilot/ui';
import '@gixcopilot/ui/styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root');
createRoot(root).render(
  <StrictMode>
    <CopilotProvider runtimeUrl="/api/copilot">
      <CopilotChat />
    </CopilotProvider>
  </StrictMode>,
);
`,
    },
    { path: 'README.md', content: readme(options, 'npm start          # server on :4000\nnpm run dev        # web app, proxies /api/copilot\n') },
  ];
}

function angularFiles(options: TemplateOptions): PlannedFile[] {
  const angular = TOOLCHAIN.angular;
  return [
    ...nodeFiles(options, true),
    {
      path: 'package.json',
      content: packageJson(options, {
        scripts: { build: 'tsc -p tsconfig.json && ng build', typecheck: 'tsc -p tsconfig.json --noEmit && tsc -p tsconfig.app.json --noEmit', test: 'vitest run', start: 'node --env-file-if-exists=.env dist/server.js', dev: 'ng serve' },
        sdk: [...NODE_SDK, 'angular'],
        dependencies: { '@angular/common': angular, '@angular/compiler': angular, '@angular/core': angular, '@angular/platform-browser': angular, rxjs: TOOLCHAIN.rxjs, tslib: '^2.8.1' },
        // @angular/build 21 declares an optional peer on Vitest 4.
        devDependencies: { '@angular/build': angular, '@angular/cli': angular, '@angular/compiler-cli': angular, vitest: '4.1.11' },
      }),
    },
    {
      path: 'angular.json',
      content: `${JSON.stringify(
        {
          $schema: './node_modules/@angular/cli/lib/config/schema.json',
          version: 1,
          cli: { analytics: false },
          newProjectRoot: '.',
          projects: {
            app: {
              projectType: 'application',
              root: '',
              sourceRoot: 'src/app',
              architect: {
                build: { builder: '@angular/build:application', options: { outputPath: 'web-dist', index: 'src/app/index.html', browser: 'src/app/main.ts', tsConfig: 'tsconfig.app.json' } },
                serve: { builder: '@angular/build:dev-server', options: { proxyConfig: 'proxy.conf.json' }, configurations: { development: { buildTarget: 'app:build:development' } }, defaultConfiguration: 'development' },
              },
            },
          },
        },
        null,
        2,
      )}\n`,
    },
    { path: 'proxy.conf.json', content: `${JSON.stringify({ '/api/copilot': { target: 'http://127.0.0.1:4000', pathRewrite: { '^/api/copilot': '' } } }, null, 2)}\n` },
    { path: 'tsconfig.app.json', content: `${JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'ES2022', moduleResolution: 'bundler', strict: true, skipLibCheck: true, experimentalDecorators: true, useDefineForClassFields: false, lib: ['ES2023', 'DOM'], types: [], outDir: 'out-tsc' }, files: ['src/app/main.ts'] }, null, 2)}\n` },
    { path: 'src/app/index.html', content: `<!doctype html>\n<html lang="en">\n  <head>\n    <meta charset="utf-8" />\n    <title>${options.name}</title>\n    <meta name="viewport" content="width=device-width, initial-scale=1" />\n  </head>\n  <body>\n    <app-root></app-root>\n  </body>\n</html>\n` },
    {
      path: 'src/app/main.ts',
      content: `import { ChangeDetectionStrategy, Component, provideZonelessChangeDetection } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { CopilotChatComponent, provideCopilot } from '@gixcopilot/angular';

@Component({
  selector: 'app-root',
  imports: [CopilotChatComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '<main><h1>${options.name}</h1><aicopilot-chat label="Copilot" /></main>',
})
class AppComponent {}

bootstrapApplication(AppComponent, {
  providers: [provideZonelessChangeDetection(), provideCopilot({ endpoint: '/api/copilot' })],
}).catch((error: unknown) => console.error(error));
`,
    },
    { path: 'README.md', content: readme(options, 'npm start          # server on :4000\nnpm run dev        # Angular dev server, proxies /api/copilot\n') },
  ];
}

function enterpriseFiles(options: TemplateOptions): PlannedFile[] {
  return [
    ...nodeFiles(options, false).filter((file) => file.path !== 'src/server.ts' && file.path !== 'src/server.spec.ts'),
    {
      path: 'package.json',
      content: packageJson(options, {
        scripts: { build: 'tsc -p tsconfig.json', typecheck: 'tsc -p tsconfig.json --noEmit', test: 'vitest run', start: 'node --env-file-if-exists=.env dist/server.js' },
        sdk: [...NODE_SDK, 'rag', 'telemetry', 'tenancy'],
      }),
    },
    {
      path: '.env.example',
      content: `${ENV_EXAMPLE}# HS256 secret shared with your identity gateway, which issues tokens with sub, tenant_id, permissions.
AICOPILOT_JWT_SECRET=
`,
    },
    {
      path: 'src/auth.ts',
      content: `import { createHmac, timingSafeEqual } from 'node:crypto';
import type { AuthenticationAdapter, Identity } from '@gixcopilot/security';

/**
 * Verifies HS256 JWTs issued by your identity gateway. Tenant and permissions come ONLY from
 * the verified token, never from request bodies or the model. For RS256/OIDC, replace this
 * adapter with your provider's verifier.
 */
export function createJwtAuthentication(secret: string): AuthenticationAdapter {
  return {
    authenticate(request: unknown) {
      const header = (request as { headers?: Record<string, string | undefined> }).headers?.['authorization'];
      const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
      return Promise.resolve(token ? verify(token, secret) : null);
    },
  };
}

function verify(token: string, secret: string): Identity | null {
  const [head, body, signature] = token.split('.');
  if (!head || !body || !signature) return null;
  const header = JSON.parse(Buffer.from(head, 'base64url').toString()) as { alg?: string };
  if (header.alg !== 'HS256') return null;
  const expected = createHmac('sha256', secret).update(\`\${head}.\${body}\`).digest();
  const provided = Buffer.from(signature, 'base64url');
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return null;
  const claims = JSON.parse(Buffer.from(body, 'base64url').toString()) as { sub?: string; exp?: number; tenant_id?: string; permissions?: string[] };
  if (!claims.sub || typeof claims.exp !== 'number' || claims.exp < Date.now() / 1000) return null;
  return { subject: claims.sub, roles: [], permissions: claims.permissions ?? [], attributes: claims.tenant_id ? { tenantId: claims.tenant_id } : {} };
}
`,
    },
    {
      path: 'src/knowledge.ts',
      content: `import { z } from 'zod';
import { createDeterministicEmbeddingProvider, createInMemoryVectorStore, createRetriever } from '@gixcopilot/rag';
import type { SecurityContext } from '@gixcopilot/security';
import { defineTool } from '@gixcopilot/tools';

/**
 * Tenant-scoped knowledge search. DEVELOPMENT SETUP: in-memory vectors and deterministic test
 * embeddings; use @gixcopilot/vectorstore-pgvector and a real embedding provider in production.
 * The retriever filters by the caller's authenticated tenant and ACL BEFORE text reaches the model.
 */
export function createKnowledge() {
  const embeddingProvider = createDeterministicEmbeddingProvider({ dimensions: 64 });
  const vectorStore = createInMemoryVectorStore();
  const retriever = createRetriever({ vectorStore, embeddingProvider });
  const searchTool = defineTool({
    name: 'knowledge.search',
    description: 'Search the knowledge base the current user may read',
    input: z.object({ query: z.string().min(1) }),
    security: { risk: 'read-only', approval: 'none' },
    async execute({ query }, context) {
      const securityContext = (context.metadata as { securityContext?: SecurityContext } | undefined)?.securityContext;
      if (!securityContext?.identity) throw new Error('Authenticated caller required.');
      const result = await retriever.retrieve({ text: query, topK: 4 }, { securityContext, signal: context.signal });
      return { passages: result.items.map(({ item }) => item.chunk.content), citations: result.citations };
    },
  });
  return { vectorStore, embeddingProvider, searchTool };
}
`,
    },
    {
      path: 'src/server.ts',
      content: `import { createCopilot } from '@gixcopilot/node';
import { createMockProvider } from '@gixcopilot/provider-mock';
import { createOpenAIProvider } from '@gixcopilot/provider-openai';
import { createActionFirewall, createInMemoryAuditSink } from '@gixcopilot/security';
import type { AuthenticationAdapter } from '@gixcopilot/security';
import { composeTelemetry, createOpenTelemetryAdapter, createRecordingTelemetry } from '@gixcopilot/telemetry';
import { createConversationRecorder, createInMemoryConversationStore } from '@gixcopilot/tenancy';
import { createJwtAuthentication } from './auth.js';
import { createKnowledge } from './knowledge.js';
import { tools } from './tools/index.js';

/**
 * Enterprise baseline: authentication required, tenant from the verified token, every tool
 * through the Action Firewall with audit, tenant-scoped RAG, conversation records per tenant,
 * and redacted telemetry. Replace the in-memory stores with @gixcopilot/persistence-postgres
 * for production.
 */
export function createApp(env: NodeJS.ProcessEnv = process.env, authentication?: AuthenticationAdapter) {
  const secret = env['AICOPILOT_JWT_SECRET'];
  const auth = authentication ?? (secret ? createJwtAuthentication(secret) : undefined);
  if (!auth) throw new Error('AICOPILOT_JWT_SECRET (or an authentication adapter) is required.');
  const apiKey = env['OPENAI_API_KEY'];
  const audit = createInMemoryAuditSink();
  const conversations = createInMemoryConversationStore();
  const knowledge = createKnowledge();
  const telemetry = composeTelemetry([createOpenTelemetryAdapter(), createRecordingTelemetry({ mode: 'redacted' })]);
  const copilot = createCopilot({
    model: apiKey ? { provider: 'openai', model: env['OPENAI_MODEL'] ?? 'gpt-4o-mini' } : { provider: 'mock', model: 'dev' },
    providers: apiKey ? [createOpenAIProvider({ apiKey })] : [createMockProvider({ id: 'mock', scenario: { chunks: ['Enterprise development mock answer.'] } })],
    tools: [...tools, knowledge.searchTool],
    telemetry,
    security: { authentication: auth, firewall: createActionFirewall({ audit }) },
    server: { requireAuthentication: true, runObservers: [createConversationRecorder(conversations)] },
  });
  return { copilot, audit, conversations, knowledge };
}

if (process.argv[1]?.endsWith('server.js')) {
  const { copilot } = createApp();
  const port = Number(process.env['PORT'] ?? 4000);
  await copilot.listen({ host: '127.0.0.1', port });
  console.log(\`Enterprise copilot on http://127.0.0.1:\${port}\`);
}
`,
    },
    {
      path: 'src/server.spec.ts',
      content: `import { describe, expect, it } from 'vitest';
import { createStaticAuthenticationAdapter } from '@gixcopilot/security';
import { createApp } from './server.js';

describe('enterprise copilot', () => {
  it('refuses anonymous callers and records conversations per tenant', async () => {
    const auth = createStaticAuthenticationAdapter({ alice: { subject: 'alice', roles: [], permissions: [], attributes: { tenantId: 'acme' } } });
    const { copilot, conversations } = createApp({}, auth);
    try {
      const anonymous = await copilot.app.inject({ method: 'POST', url: '/runs', payload: { messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }] } });
      expect(anonymous.statusCode).toBe(401);
      const result = await copilot.run({ threadId: 't1', messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }], headers: { authorization: 'Bearer alice' } });
      expect(result.status).toBe('completed');
      expect(await conversations.forTenant({ tenantId: 'acme' }).getThread('t1')).not.toBeNull();
      expect(await conversations.forTenant({ tenantId: 'globex' }).getThread('t1')).toBeNull();
    } finally {
      await copilot.close();
    }
  });
});
`,
    },
    { path: 'README.md', content: readme(options, 'npm start          # requires AICOPILOT_JWT_SECRET\n') },
  ];
}

export function templateFiles(options: TemplateOptions): PlannedFile[] {
  switch (options.template) {
    case 'node':
      return [
        ...nodeFiles(options, false),
        { path: 'package.json', content: packageJson(options, { scripts: { build: 'tsc -p tsconfig.json', typecheck: 'tsc -p tsconfig.json --noEmit', test: 'vitest run', start: 'node --env-file-if-exists=.env dist/server.js', dev: 'tsc -p tsconfig.json && node --env-file-if-exists=.env dist/server.js' }, sdk: NODE_SDK }) },
        { path: 'README.md', content: readme(options, 'npm start          # server on :4000\n') },
      ];
    case 'react':
      return reactFiles(options);
    case 'angular':
      return angularFiles(options);
    case 'enterprise':
      return enterpriseFiles(options);
  }
}

export function toolFile(toolName: string, identifier: string): string {
  return `import { z } from 'zod';
import { defineTool } from '@gixcopilot/tools';

/**
 * ${toolName} - generated by \`aicopilot add tool\`. Describe what it does for the model, keep
 * the input schema strict, and classify its risk honestly: 'read-only', 'write' or
 * 'destructive'. Write and destructive tools should require approval.
 */
export const ${identifier} = defineTool({
  name: '${toolName}',
  description: 'TODO: describe what ${toolName} does and when to use it.',
  input: z.object({ id: z.string().min(1) }).strict(),
  output: z.object({ id: z.string(), status: z.string() }),
  security: { risk: 'read-only', approval: 'none', requiredPermissions: [] },
  async execute({ id }, context) {
    context.signal.throwIfAborted();
    // TODO: call your system of record here.
    return { id, status: 'unknown' };
  },
});
`;
}

export function toolSpec(toolName: string, identifier: string, fileName: string): string {
  return `import { describe, expect, it } from 'vitest';
import { createToolRegistry, createToolRuntime, createDefaultToolResolver } from '@gixcopilot/tools';
import { ${identifier} } from './${fileName}.js';

describe('${toolName}', () => {
  it('validates input and returns output through the tool runtime', async () => {
    const registry = createToolRegistry();
    registry.register(${identifier});
    const runtime = createToolRuntime({ resolver: createDefaultToolResolver(registry) });
    const ok = await runtime.execute({ toolCallId: 'call-1', name: '${toolName}', arguments: { id: 'A-1' }, context: { runId: 'run-1' as never, signal: new AbortController().signal } });
    expect(ok.status).toBe('success');
    const bad = await runtime.execute({ toolCallId: 'call-2', name: '${toolName}', arguments: { id: 42 }, context: { runId: 'run-1' as never, signal: new AbortController().signal } });
    expect(bad.status).toBe('error');
  });
});
`;
}

export function agentFile(agentId: string, identifier: string): string {
  return `import { defineAgent } from '@gixcopilot/agents';

/**
 * ${agentId} agent - generated by \`aicopilot add agent\`. It can only use the tools listed here,
 * and every tool call still passes the Action Firewall with the caller's identity.
 */
export const ${identifier}Agent = defineAgent({
  id: '${agentId}',
  name: '${agentId}',
  description: 'TODO: what this agent is responsible for.',
  instructions: 'You are the ${agentId} agent. Answer only within your responsibility and cite your sources.',
  tools: [],
  limits: { maxIterations: 6, maxToolCalls: 8 },
});
`;
}

export function agentSpec(agentId: string, identifier: string, fileName: string): string {
  return `import { describe, expect, it } from 'vitest';
import { createAgentRegistry, validateAgentGraph } from '@gixcopilot/agents';
import { ${identifier}Agent } from './${fileName}.js';

describe('${agentId} agent', () => {
  it('is a valid, registrable agent definition', () => {
    const registry = createAgentRegistry();
    registry.register(${identifier}Agent);
    expect(registry.get('${agentId}')?.id).toBe('${agentId}');
    expect(() => validateAgentGraph(registry)).not.toThrow();
  });
});
`;
}
