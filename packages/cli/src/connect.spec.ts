import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { run } from './index.js';
import type { CliIo } from './index.js';
import { startMcpServe } from './connect.js';

let api: Server;
let apiUrl = '';
const deleted: string[] = [];

beforeAll(async () => {
  // Any backend: here a plain Node HTTP service with bearer auth.
  api = createServer((req, res) => {
    if (req.headers.authorization !== 'Bearer shop-token') {
      res.writeHead(401, { 'content-type': 'application/json' }).end('{"error":"unauthorized"}');
      return;
    }
    const url = new URL(req.url ?? '/', 'http://x');
    const id = url.pathname.split('/')[2] ?? '';
    if (req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ id, name: `Item ${id}` }));
    } else if (req.method === 'DELETE') {
      deleted.push(id);
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ deleted: id }));
    } else res.writeHead(405).end();
  });
  await new Promise<void>((resolve) => api.listen(0, '127.0.0.1', resolve));
  const address = api.address();
  if (!address || typeof address === 'string') throw new Error('no address');
  apiUrl = `http://127.0.0.1:${address.port}`;
});
afterAll(async () => {
  await new Promise<void>((resolve) => api.close(() => resolve()));
});

async function workspace(env: Record<string, string> = {}) {
  const cwd = await mkdtemp(join(tmpdir(), 'aicopilot-connect-'));
  const out: string[] = [];
  const err: string[] = [];
  const io: CliIo = { cwd, env, out: (line) => out.push(line), err: (line) => err.push(line) };
  return { cwd, io, text: () => out.join('\n'), errors: () => err.join('\n') };
}

const MANIFEST = (url: string) => `id: shop
baseUrl: ${url}
auth: { type: bearer, tokenEnv: SHOP_TOKEN }
endpoints:
  items.get:
    method: GET
    path: /items/{id}
    description: Get an item
    input: { type: object, properties: { id: { type: string } }, required: [id] }
  items.delete:
    method: DELETE
    path: /items/{id}
    description: Delete an item
    input: { type: object, properties: { id: { type: string } }, required: [id] }
`;

describe('aicopilot add api / api check', () => {
  it('scaffolds a manifest that validates, and never overwrites without --force', async () => {
    const { cwd, io, text, errors } = await workspace({ SHOP_URL: 'https://shop.example.com', SHOP_TOKEN: 't' });
    expect(await run(['add', 'api', 'shop', '--url', 'https://shop.example.com'], io)).toBe(0);
    const manifest = await readFile(join(cwd, 'apis/shop.api.yaml'), 'utf8');
    expect(manifest).toContain('baseUrl: ${env:SHOP_URL}');
    expect(manifest).toContain('tokenEnv: SHOP_TOKEN');
    expect(await run(['add', 'api', 'shop'], io)).toBe(1);
    expect(errors()).toContain('already exists');
    expect(await run(['api', 'check', 'apis/shop.api.yaml'], io)).toBe(0);
    expect(text()).toContain('shop.items.get');
    expect(text()).toMatch(/shop\.items\.create\s+write\s+POST \/items/);
    expect(await run(['api', 'check', 'apis/shop.api.yaml', '--json'], io)).toBe(0);
    expect(await run(['api', 'check', 'missing.yaml'], io)).toBe(2);
    expect(await run(['add', 'api', 'shop2', '--url', 'ftp://x'], io)).toBe(2);
  });
});

describe('aicopilot mcp serve', () => {
  it('serves read-only tools over HTTP by default, behind a bearer token, through the firewall', async () => {
    const { cwd, io, errors } = await workspace({ SHOP_TOKEN: 'shop-token', MCP_TOKEN: 'mcp-secret' });
    await writeFile(join(cwd, 'shop.api.yaml'), MANIFEST(apiUrl));
    const handle = await startMcpServe(io, 'shop.api.yaml', { http: true, port: '0', 'token-env': 'MCP_TOKEN' });
    if (!handle?.url) throw new Error('server did not start');
    try {
      expect(handle.tools).toEqual(['shop.items.get']);
      expect(errors()).toContain('1 write tool(s) hidden');

      const unauthorized = await fetch(handle.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      expect(unauthorized.status).toBe(401);

      const client = new Client({ name: 'assistant', version: '1' });
      await client.connect(new StreamableHTTPClientTransport(new URL(handle.url), { requestInit: { headers: { authorization: 'Bearer mcp-secret' } } }));
      expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual(['shop.items.get']);
      const result = await client.callTool({ name: 'shop.items.get', arguments: { id: '7' } });
      expect(result.structuredContent).toEqual({ status: 200, body: { id: '7', name: 'Item 7' } });
      expect(errors()).toMatch(/audit .*"tool":"shop\.items\.get".*"decision":"allow"/);
      const hidden = await client.callTool({ name: 'shop.items.delete', arguments: { id: '7' } });
      expect(hidden.isError).toBe(true);
      expect(deleted).toEqual([]);
      await client.close();
    } finally {
      await handle.close();
    }
  });

  it('exposes write tools only with --allow-writes (and warns)', async () => {
    const { cwd, io, errors } = await workspace({ SHOP_TOKEN: 'shop-token' });
    await writeFile(join(cwd, 'shop.api.yaml'), MANIFEST(apiUrl));
    const handle = await startMcpServe(io, 'shop.api.yaml', { http: true, port: '0', 'allow-writes': true });
    if (!handle?.url) throw new Error('server did not start');
    try {
      expect(handle.tools).toEqual(['shop.items.get', 'shop.items.delete']);
      expect(errors()).toContain('Warning: --allow-writes');
      const client = new Client({ name: 'assistant', version: '1' });
      await client.connect(new StreamableHTTPClientTransport(new URL(handle.url)));
      const result = await client.callTool({ name: 'shop.items.delete', arguments: { id: '9' } });
      expect(result.isError).toBeFalsy();
      expect(deleted).toEqual(['9']);
      await client.close();
    } finally {
      await handle.close();
    }
  });

  it('refuses to start without the token variable it was told to require', async () => {
    const { cwd, io, errors } = await workspace({ SHOP_TOKEN: 'shop-token' });
    await writeFile(join(cwd, 'shop.api.yaml'), MANIFEST(apiUrl));
    expect(await startMcpServe(io, 'shop.api.yaml', { http: true, port: '0', 'token-env': 'NOPE' })).toBeUndefined();
    expect(errors()).toContain('NOPE is not set');
  });
});
