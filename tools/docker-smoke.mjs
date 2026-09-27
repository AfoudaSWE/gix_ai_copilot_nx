#!/usr/bin/env node
// Container smoke test (Phase 12 Section 163, 180-181): builds the images, starts
// postgres + redis + migrate + api + worker + platform with docker compose, and exercises the
// running system over HTTP. Uses AICOPILOT_ENV=test with the labelled mock model provider, so
// it needs no paid API. Secrets are generated per run and never written to disk.
//
//   node tools/docker-smoke.mjs [--keep] [--no-build]

import { execFileSync } from 'node:child_process';
import { createHmac, randomBytes } from 'node:crypto';
import { createServer } from 'node:net';

async function freePort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Could not select a local port.');
  await new Promise((resolve) => server.close(resolve));
  return address.port;
}

const apiPort = await freePort();
let platformPort = await freePort();
while (platformPort === apiPort) platformPort = await freePort();
const api = `http://127.0.0.1:${apiPort}`;
const platform = `http://127.0.0.1:${platformPort}`;

const keep = process.argv.includes('--keep');
const build = !process.argv.includes('--no-build');
const env = {
  ...process.env,
  AICOPILOT_ENV: 'test',
  POSTGRES_PASSWORD: randomBytes(16).toString('hex'),
  AICOPILOT_JWT_SECRET: randomBytes(32).toString('hex'),
  AICOPILOT_SECRET_KEY: randomBytes(32).toString('base64'),
  AICOPILOT_METRICS_TOKEN: randomBytes(16).toString('hex'),
  AICOPILOT_MODEL_PROVIDER: 'mock',
  AICOPILOT_MODEL: 'dev',
  AICOPILOT_HOST_API_PORT: String(apiPort),
  AICOPILOT_HOST_PLATFORM_PORT: String(platformPort),
  OPENAI_API_KEY: '',
};
const compose = (...args) => execFileSync('docker', ['compose', '-p', 'aicopilot-smoke', ...args], { env, stdio: 'inherit' });
const composeOut = (...args) => execFileSync('docker', ['compose', '-p', 'aicopilot-smoke', ...args], { env, encoding: 'utf8' });

function jwt(claims) {
  const part = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const body = `${part({ alg: 'HS256', typ: 'JWT' })}.${part({ iss: 'aicopilot', aud: 'aicopilot-api', exp: Math.floor(Date.now() / 1000) + 600, ...claims })}`;
  return `${body}.${createHmac('sha256', env.AICOPILOT_JWT_SECRET).update(body).digest('base64url')}`;
}

async function until(label, check, timeoutMs = 180_000) {
  const started = Date.now();
  for (;;) {
    try {
      if (await check()) return;
    } catch {
      // not yet
    }
    if (Date.now() - started > timeoutMs) throw new Error(`timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}

const results = [];
const step = async (name, fn) => {
  const started = Date.now();
  try {
    await fn();
    results.push({ name, ok: true, ms: Date.now() - started });
    console.log(`PASS ${name}`);
  } catch (error) {
    results.push({ name, ok: false, error: error.message });
    console.log(`FAIL ${name}: ${error.message}`);
  }
};
const expect = (condition, message) => {
  if (!condition) throw new Error(message);
};

try {
  compose('up', ...(build ? ['--build'] : []), '--detach', '--wait');
  const root = { authorization: `Bearer ${jwt({ sub: 'root', permissions: ['platform.admin'] })}`, 'content-type': 'application/json' };
  const alice = { authorization: `Bearer ${jwt({ sub: 'alice', tenant_id: 'acme' })}`, 'content-type': 'application/json' };
  const bob = { authorization: `Bearer ${jwt({ sub: 'bob', tenant_id: 'globex' })}`, 'content-type': 'application/json' };

  await step('api ready (database + migrations + redis)', () => until('ready', async () => (await fetch(`${api}/ready`)).ok));
  await step('platform serves the UI and proxies the management API', async () => {
    expect((await fetch(`${platform}/`)).ok, 'platform index');
    expect((await fetch(`${platform}/management/v1/me`)).status === 401, 'unauthenticated management call must be 401');
  });
  await step('containers run as non-root', async () => {
    for (const service of ['api', 'worker', 'platform']) {
      const user = composeOut('exec', '-T', service, 'id', '-u').trim();
      expect(user !== '0', `${service} runs as root`);
    }
  });
  await step('no .env or secrets baked into images', async () => {
    for (const service of ['api', 'worker']) {
      const files = composeOut('exec', '-T', service, 'sh', '-c', 'find /app -name ".env*" -not -name ".env.example" | head -5').trim();
      expect(files === '', `${service} image contains ${files}`);
    }
  });
  await step('tenants and authenticated chat (streaming) with persistence', async () => {
    for (const [id, owner] of [['acme', 'alice'], ['globex', 'bob']]) {
      const response = await fetch(`${api}/management/v1/tenants`, { method: 'POST', headers: root, body: JSON.stringify({ id, name: id, owner }) });
      expect(response.status === 201, `create tenant ${id}: ${response.status}`);
    }
    expect((await fetch(`${api}/runs`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }] }) })).status === 401, 'anonymous run must be refused');
    const run = await fetch(`${api}/runs`, { method: 'POST', headers: alice, body: JSON.stringify({ threadId: 'smoke-thread', messages: [{ role: 'user', content: [{ type: 'text', text: 'Hello' }] }] }) });
    const text = await run.text();
    expect(run.ok && text.includes('message.delta') && text.includes('run.completed'), 'streamed run');
    const threads = await (await fetch(`${api}/management/v1/conversations`, { headers: alice })).json();
    expect(threads.items.some((thread) => thread.id === 'smoke-thread'), 'thread persisted');
  });
  await step('tenant isolation across the running stack', async () => {
    const threads = await (await fetch(`${api}/management/v1/conversations`, { headers: bob })).json();
    expect(threads.items.length === 0, 'globex sees acme conversations');
    const usage = await (await fetch(`${api}/management/v1/usage?groupBy=kind`, { headers: bob })).json();
    expect(usage.rows.length === 0, 'globex sees acme usage');
  });
  await step('usage recorded and traces visible to operators', async () => {
    const usage = await (await fetch(`${api}/management/v1/usage?groupBy=kind`, { headers: alice })).json();
    expect(usage.rows.some((row) => row.key.kind === 'request'), 'request usage');
    const traces = await (await fetch(`${api}/management/v1/traces`, { headers: alice })).json();
    expect(Array.isArray(traces) && traces.length > 0, 'traces');
  });
  await step('worker processes jobs (reindex is queued and deduplicated)', async () => {
    const sourceResponse = await fetch(`${api}/management/v1/resources`, { method: 'POST', headers: alice, body: JSON.stringify({ kind: 'knowledge-source', name: 'handbook', spec: { sourceId: 'handbook', type: 'custom' } }) });
    const source = await sourceResponse.json();
    expect(sourceResponse.status === 201 && typeof source.resource?.id === 'string', `create knowledge source: ${sourceResponse.status} ${JSON.stringify(source)}`);
    const reindexHeaders = { authorization: alice.authorization };
    const firstResponse = await fetch(`${api}/management/v1/knowledge/${source.resource.id}/reindex`, { method: 'POST', headers: reindexHeaders });
    const first = await firstResponse.json();
    expect(firstResponse.status === 202, `first reindex: ${firstResponse.status} ${JSON.stringify(first)}`);
    const againResponse = await fetch(`${api}/management/v1/knowledge/${source.resource.id}/reindex`, { method: 'POST', headers: reindexHeaders });
    const again = await againResponse.json();
    expect(againResponse.status === 202, `repeat reindex: ${againResponse.status} ${JSON.stringify(again)}`);
    expect(again.duplicate === true, `duplicate reindex suppressed: ${JSON.stringify({ first, again })}`);
    // A "custom" source needs an app handler: the worker must dead-letter it, not retry forever.
    await until('job dead-lettered', async () => (await (await fetch(`${api}/management/v1/jobs/${first.jobId}`, { headers: alice })).json()).status === 'failed', 60_000);
  });
  await step('metrics are protected and free of tenant data', async () => {
    expect((await fetch(`${api}/metrics`)).status === 401, 'metrics without token');
    const metrics = await (await fetch(`${api}/metrics`, { headers: { authorization: `Bearer ${env.AICOPILOT_METRICS_TOKEN}` } })).text();
    expect(metrics.includes('copilot_runs_total') && !metrics.includes('acme'), 'metrics content');
  });
  await step('API restart keeps durable data', async () => {
    compose('restart', 'api');
    await until('ready after restart', async () => (await fetch(`${api}/ready`)).ok, 60_000);
    const threads = await (await fetch(`${api}/management/v1/conversations`, { headers: alice })).json();
    expect(threads.items.some((thread) => thread.id === 'smoke-thread'), 'data after restart');
  });
} finally {
  if (!keep) compose('down', '--volumes', '--remove-orphans');
}
const failed = results.filter((result) => !result.ok);
console.log(JSON.stringify({ passed: results.length - failed.length, failed: failed.length, results }, null, 2));
process.exit(failed.length > 0 ? 1 : 0);
