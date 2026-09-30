import { createToolRegistry } from '@gixcopilot/tools';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFixture, removeFixture } from './fixtures.spec-helper.js';
import { attachStudio, loadGeneratedTools } from './server.js';

// A lazy import must not evaluate this module in production, even with an explicit override.
vi.mock('@gixcopilot/studio/server', () => { throw new Error('Studio imported in production'); });

const roots: string[] = [];
function fixture(files: Readonly<Record<string, string>>): string {
  const root = createFixture(files);
  roots.push(root);
  return root;
}
afterEach(() => {
  vi.unstubAllEnvs();
  for (const root of roots.splice(0)) removeFixture(root);
});

const toolSource = `const tool = (name, baseUrl) => ({
  name, description: 'Fixture tool', location: 'backend', enabled: true,
  inputSchema: { parse: (value) => value },
  security: { risk: 'read-only', approval: 'none' },
  execute: async () => baseUrl,
});\n`;

describe('loadGeneratedTools', () => {
  it('registers create*Tools and async register*Tools with the trusted base URL', async () => {
    const root = fixture({
      '.gix/tools/http.mjs': `${toolSource}export function createOrdersTools(options) { return [tool('orders.list', options.baseUrl)]; }`,
      '.gix/tools/openapi.mjs': `${toolSource}export async function registerCustomersTools(registry, options) { registry.register(tool('customers.list', options.baseUrl)); }`,
      '.gix/tools/typescript.ts': `${toolSource}export function createTypescriptTools(options: { readonly baseUrl: string }) { return [tool('typescript.list', options.baseUrl)]; }`,
      '.gix/tools/javascript.js': `${toolSource}export function createJavascriptTools(options) { return [tool('javascript.list', options.baseUrl)]; }`,
      '.gix/tools/ignored.d.ts': 'throw new Error("declarations must not load");',
      '.gix/tools/readme.txt': 'throw new Error("text must not load");',
      '.gix/tools/helpers.mjs': 'export function unrelated() { throw new Error("helper must not run"); }\nexport const metadata = {};',
    });
    const registry = createToolRegistry();
    const loaded = await loadGeneratedTools(registry, { root, baseUrl: 'https://api.example.test' });
    expect(loaded).toEqual({ registered: ['orders.list', 'javascript.list', 'customers.list', 'typescript.list'], skipped: [] });
    expect(registry.list().map((tool) => tool.name)).toEqual(loaded.registered);
    for (const tool of registry.list()) {
      // The fixture ignores execution context; invoke only to observe the factory's options.
      expect(await tool.execute({}, { signal: new AbortController().signal, runId: 'fixture', threadId: 'fixture' })).toBe('https://api.example.test');
    }
  });

  it('skips HTTP factories without a base URL, logs why, and still registers OpenAPI exports', async () => {
    const root = fixture({
      '.gix/tools/http.mjs': 'export function createOrdersTools() { throw new Error("HTTP factory must not run"); }',
      '.gix/tools/openapi.mjs': `${toolSource}export async function registerCustomersTools(registry, options) { registry.register(tool('customers.list', options.baseUrl ?? 'spec-url')); }`,
    });
    const registry = createToolRegistry();
    const logs: string[] = [];
    const loaded = await loadGeneratedTools(registry, { root, log: (line) => logs.push(line) });
    expect(loaded.registered).toEqual(['customers.list']);
    expect(loaded.skipped).toEqual([{ file: 'http.mjs', reason: 'set GIX_API_BASE_URL to the API these tools call' }]);
    expect(logs).toEqual(['GIX: skipped http.mjs: set GIX_API_BASE_URL to the API these tools call.']);
  });

  it('returns an empty result when no approved tool directory exists', async () => {
    expect(await loadGeneratedTools(createToolRegistry(), { root: fixture({}) })).toEqual({ registered: [], skipped: [] });
  });
});

describe('production isolation', () => {
  it('returns false without importing Studio for explicit production', async () => {
    const { createCopilot, createMockProvider } = await import('./server.js');
    const copilot = createCopilot({ model: { provider: 'mock', model: 'fixture' }, providers: [createMockProvider({ scenario: { chunks: ['fixture'] } })] });
    try {
      expect(await attachStudio(copilot, { root: fixture({}), environment: 'production' })).toBe(false);
    } finally { await copilot.close(); }
  });

  it.each([undefined, 'development'])('cannot override NODE_ENV=production with %s', async (environment) => {
    vi.stubEnv('NODE_ENV', 'production');
    const { createCopilot, createMockProvider } = await import('./server.js');
    const copilot = createCopilot({ model: { provider: 'mock', model: 'fixture' }, providers: [createMockProvider({ scenario: { chunks: ['fixture'] } })] });
    try {
      expect(await attachStudio(copilot, { root: fixture({}), environment })).toBe(false);
    } finally { await copilot.close(); }
  });
});
