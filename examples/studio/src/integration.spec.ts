import { readdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { createCopilot } from '@gixcopilot/node';
import { isDevelopmentToolName, PlaneViolationError } from '@gixcopilot/studio';
import { attachStudio, STUDIO_TOKEN_HEADER } from '@gixcopilot/studio/server';
import { defineTool } from '@gixcopilot/tools';
import { afterEach, describe, expect, it } from 'vitest';
import { copySampleApp, createRecordingProvider, createStudioExample, SAMPLE_APP } from './main.js';
import type { StudioExample } from './main.js';

const previewDirectory = fileURLToPath(new URL('../../../packages/studio-preview/web-dist/', import.meta.url));
const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

async function start(root = copySampleApp(), environment = 'development'): Promise<StudioExample & { headers: Record<string, string> }> {
  // Only throwaway copies are removed, never the checked-in sample app.
  if (root !== SAMPLE_APP) cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  const example = await createStudioExample(root, { environment, previewDirectory });
  cleanups.push(() => example.copilot.close());
  if (!example.studio) return { ...example, headers: {} };
  const page = await example.copilot.app.inject({ method: 'GET', url: '/__gix', headers: { host: 'localhost:4120' } });
  const token = /name="gix-studio-token" content="([^"]+)"/.exec(page.body)?.[1] ?? '';
  return { ...example, headers: { host: 'localhost:4120', origin: 'http://localhost:4120', [STUDIO_TOKEN_HEADER]: token } };
}

describe('Developer Studio attached to createCopilot', () => {
  it('sees the real copilot: tools, firewall, model runtime and the preview runtime', async () => {
    const { copilot, headers } = await start();
    const page = await copilot.app.inject({ method: 'GET', url: '/__gix', headers: { host: 'localhost:4120' } });
    expect(page.body).toContain('data-runtime="/"');
    const diagnostics = (await copilot.app.inject({ method: 'GET', url: '/__gix/api/diagnostics', headers })).json<{ runtime: { key: string; status: string; value?: unknown }[] }>();
    const row = (key: string) => diagnostics.runtime.find((entry) => entry.key === key);
    expect(row('firewall')?.status).toBe('ok');
    expect(row('registered-tools')?.value).toBe(1);
    const test = (await copilot.app.inject({ method: 'POST', url: '/__gix/api/config/model/test', headers, payload: {} })).json<Record<string, unknown>>();
    expect(test).toMatchObject({ success: true, provider: 'mock', model: 'demo' });
    const config = (await copilot.app.inject({ method: 'GET', url: '/__gix/api/config', headers })).json<{ security: { firewall: boolean; toolPolicies: { name: string }[] } }>();
    expect(config.security).toMatchObject({ firewall: true, toolPolicies: [{ name: 'applications.list' }] });
    expect((await copilot.app.inject({ method: 'GET', url: '/__gix/preview/', headers: { host: 'localhost:4120' } })).statusCode).toBe(200);
  });

  it('never offers development capabilities to the application model (ADR 0023)', async () => {
    const { copilot, requests, headers } = await start();
    await copilot.app.inject({ method: 'POST', url: '/__gix/api/discovery/project', headers, payload: {} });
    const result = await copilot.run({ messages: [{ role: 'user', content: [{ type: 'text', text: 'What can you do?' }] }], headers: { authorization: 'Bearer local-dev-token' } });
    expect(result.text).toContain('Hello from the sample copilot');
    const offered = requests.flatMap((request) => (request.tools ?? []).map((tool) => tool.name));
    expect(offered).toEqual(['applications.list']);
    expect(offered.filter(isDevelopmentToolName)).toEqual([]);
    expect(copilot.toolRegistry?.list().map((tool) => tool.name)).toEqual(['applications.list']);
  });

  it('refuses to start when an application tool uses a development-plane name', async () => {
    const copilot = createCopilot({
      model: { provider: 'mock', model: 'demo' },
      providers: [createRecordingProvider().provider],
      tools: [defineTool({ name: 'repo.readFile', description: 'Leaked', input: z.object({}), execute: () => Promise.resolve('') })],
    });
    cleanups.push(() => copilot.close());
    await expect(attachStudio(copilot, { root: SAMPLE_APP, environment: 'development' })).rejects.toThrow(PlaneViolationError);
  });

  it('discovers the sample app, then generates, approves and applies a proposal', async () => {
    const root = copySampleApp();
    const { copilot, headers } = await start(root);
    const project = (await copilot.app.inject({ method: 'POST', url: '/__gix/api/discovery/project', headers, payload: {} })).json<{ apis: { operations: unknown[] }[]; components: { name: string; candidate: boolean }[]; permissions: { name: string }[] }>();
    expect(project.apis.flatMap((source) => source.operations)).toHaveLength(4);
    expect(project.components.filter((component) => component.candidate).map((component) => component.name)).toEqual(['PaymentStatusCard']);
    expect(project.permissions.map((permission) => permission.name).sort()).toEqual(['APPLICATION_VIEW', 'PAYMENT_VIEW']);
    const proposal = (await copilot.app.inject({ method: 'POST', url: '/__gix/api/generators/openapi-tools', headers, payload: {} })).json<{ id: string; tools: { name: string; selected: boolean }[] }>();
    // Candidates follow normalized method/path order, not source-document order.
    expect(proposal.tools.map((tool) => `${tool.name}:${String(tool.selected)}`)).toEqual(['applications.delete:false', 'applications.list:true', 'applications.get:true']);
    await copilot.app.inject({ method: 'POST', url: `/__gix/api/proposals/${proposal.id}/approve`, headers, payload: {} });
    const applied = (await copilot.app.inject({ method: 'POST', url: `/__gix/api/proposals/${proposal.id}/apply`, headers, payload: {} })).json<{ status: string; applyResult: { validation: { name: string; status: string }[] } }>();
    expect(applied.status).toBe('applied');
    // The sample app has no scripts, so project checks are reported as skipped, not passed.
    expect(applied.applyResult.validation.find((check) => check.name === 'typecheck')?.status).toBe('skipped');
    expect(readdirSync(`${root}/.gix/tools`)).toEqual(['applications-api.openapi.ts']);
  });

  it('adds nothing in production while the copilot keeps working', async () => {
    const { copilot, studio } = await start(SAMPLE_APP, 'production');
    expect(studio).toBeUndefined();
    expect((await copilot.app.inject({ method: 'GET', url: '/__gix', headers: { host: 'localhost' } })).statusCode).toBe(404);
    expect((await copilot.app.inject({ method: 'GET', url: '/__gix/api/status', headers: { host: 'localhost' } })).statusCode).toBe(404);
    expect((await copilot.app.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200);
  });
});
