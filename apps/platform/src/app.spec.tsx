import { randomBytes } from 'node:crypto';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createEncryptedSecretStore,
  createInMemoryControlPlaneStore,
  createInMemorySecretRepository,
  createManagementPlugin,
  createManagementService,
} from '@gixcopilot/management';
import { createInMemoryAuditSink, createStaticAuthenticationAdapter } from '@gixcopilot/security';
import type { Identity } from '@gixcopilot/security';
import { createInMemoryConversationStore } from '@gixcopilot/tenancy';
import { createInMemoryUsageStore } from '@gixcopilot/usage';
import { App, NAV } from './app.js';

/**
 * The platform against the REAL management service and HTTP plugin, served in-process
 * (Fastify inject), so the UI is tested against actual authorization and validation.
 */
const apps: FastifyInstance[] = [];
afterEach(async () => {
  cleanup();
  globalThis.location.hash = '';
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

const identity = (subject: string, tenantId?: string, permissions: string[] = []): Identity => ({ subject, roles: [], permissions, ...(tenantId ? { attributes: { tenantId } } : {}) });

async function backend() {
  const store = createInMemoryControlPlaneStore();
  const audit = createInMemoryAuditSink();
  const usage = createInMemoryUsageStore();
  const service = createManagementService({
    store,
    audit,
    auditReader: { forTenant: (scope) => ({ search: () => Promise.resolve({ items: audit.list().filter((record) => record.tenantId === scope.tenantId) }) }) },
    secrets: createEncryptedSecretStore({ repository: createInMemorySecretRepository(), keys: { v1: randomBytes(32).toString('base64') }, activeKeyVersion: 'v1' }),
    conversations: createInMemoryConversationStore(),
    usage,
    catalog: { tools: () => [{ name: 'payments.refund', description: 'Refund a payment', risk: 'write', approval: 'supervisor' }], agents: () => [{ id: 'support', tools: ['payments.refund'] }] },
  });
  await service.createTenant({ subject: 'root', platformAdmin: true }, { id: 'acme', name: 'Acme', owner: 'olivia' });
  await service.upsertMembership({ subject: 'olivia', tenantId: 'acme', platformAdmin: false }, { subject: 'vic', role: 'viewer' });
  await usage.record([{ id: 'u1', tenantId: 'acme', kind: 'model', model: 'gpt-4o-mini', inputTokens: 100, outputTokens: 20, totalTokens: 120, count: 1, estimatedCostMicros: 1500, occurredAt: new Date().toISOString() }]);
  const app = Fastify();
  apps.push(app);
  await app.register(createManagementPlugin(service, { authentication: createStaticAuthenticationAdapter({ olivia: identity('olivia', 'acme'), vic: identity('vic', 'acme') }) }), { prefix: '/management/v1' });
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, 'http://platform.local');
    const response = await app.inject({
      method: (init?.method ?? 'GET') as 'GET',
      url: url.pathname + url.search,
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      ...(typeof init?.body === 'string' ? { payload: init.body } : {}),
    });
    return new Response(response.body || null, { status: response.statusCode, headers: { 'content-type': 'application/json' } });
  };
  return { fetchImpl, audit };
}

describe('management platform UI', () => {
  it('rejects a bad token and signs in with a valid one', async () => {
    const { fetchImpl } = await backend();
    render(<App fetchImpl={fetchImpl} />);
    fireEvent.change(screen.getByLabelText('Access token'), { target: { value: 'wrong' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/AUTHENTICATION_REQUIRED/);
    fireEvent.change(screen.getByLabelText('Access token'), { target: { value: 'olivia' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('navigation', { name: 'Platform sections' })).toBeTruthy();
    expect(screen.getByText(/acme · olivia · owner/)).toBeTruthy();
  });

  it('has the full navigation with landmarks, a skip link and aria-current', async () => {
    const { fetchImpl } = await backend();
    render(<App fetchImpl={fetchImpl} initialToken="olivia" />);
    const nav = await screen.findByRole('navigation', { name: 'Platform sections' });
    const links = within(nav).getAllByRole('link').map((link) => link.textContent);
    expect(links).toEqual(NAV.map((item) => item.label));
    expect(screen.getByRole('main')).toBeTruthy();
    expect((screen.getByRole('link', { name: 'Skip to content' }))?.getAttribute('href')).toBe('#main');
    fireEvent.click(within(nav).getByRole('link', { name: 'Usage' }));
    expect(document.activeElement).toBe(await screen.findByRole('heading', { name: 'Usage', level: 2 }));
    expect((within(nav).getByRole('link', { name: 'Usage' }))?.getAttribute('aria-current')).toBe('page');
    expect(await screen.findByText('gpt-4o-mini')).toBeTruthy();
    expect(screen.getAllByText(/estimated/i).length).toBeGreaterThan(0);
  });

  it('creates a project (with default environments) through the real API', async () => {
    const { fetchImpl, audit } = await backend();
    render(<App fetchImpl={fetchImpl} initialToken="olivia" />);
    fireEvent.click(await screen.findByRole('link', { name: 'Projects' }));
    const form = await screen.findByRole('form', { name: 'Create project' });
    fireEvent.change(within(form).getByLabelText('Name'), { target: { value: 'Visa Platform' } });
    fireEvent.change(within(form).getByLabelText('Slug'), { target: { value: 'visa' } });
    fireEvent.submit(form);
    expect(await within(form).findByText(/development, staging and production/)).toBeTruthy();
    expect(await screen.findByText('Visa Platform')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Environments' }));
    expect(await screen.findByText('production', { selector: 'span' })).toBeTruthy();
    expect(audit.list().some((record) => record.action === 'management.project.create')).toBe(true);
  });

  it('viewers get read-only pages; the server refuses what the UI hides', async () => {
    const { fetchImpl } = await backend();
    render(<App fetchImpl={fetchImpl} initialToken="vic" />);
    const nav = await screen.findByRole('navigation', { name: 'Platform sections' });
    expect(within(nav).queryByRole('link', { name: 'Audit' })).toBeNull();
    fireEvent.click(within(nav).getByRole('link', { name: 'Projects' }));
    await screen.findByRole('heading', { name: 'Projects' });
    expect(screen.queryByRole('form', { name: 'Create project' })).toBeNull();
    // Even if a viewer calls the API directly, the server enforces the role.
    const response = await fetchImpl('/management/v1/projects', { method: 'POST', headers: { authorization: 'Bearer vic', 'content-type': 'application/json' }, body: JSON.stringify({ name: 'x', slug: 'x' }) });
    expect(response.status).toBe(403);
  });

  it('shows tool security, rejects weakening, and never displays a stored secret', async () => {
    const { fetchImpl } = await backend();
    render(<App fetchImpl={fetchImpl} initialToken="olivia" />);
    fireEvent.click(await screen.findByRole('link', { name: 'Settings' }));
    const secretForm = await screen.findByRole('form', { name: 'Store secret' });
    fireEvent.change(within(secretForm).getByLabelText('Secret name'), { target: { value: 'openai-key' } });
    fireEvent.change(within(secretForm).getByLabelText('Secret value'), { target: { value: 'sk-ui-secret-value-0000000000' } });
    fireEvent.submit(secretForm);
    expect(await within(secretForm).findByText(/cannot be shown again/)).toBeTruthy();
    expect(await screen.findByText('openai-key')).toBeTruthy();
    expect(document.body.textContent).not.toContain('sk-ui-secret-value');

    fireEvent.click(screen.getByRole('link', { name: 'Tools' }));
    expect(await screen.findByText('payments.refund')).toBeTruthy();
    expect(screen.getByText('supervisor')).toBeTruthy();
    const weaken = await fetchImpl('/management/v1/resources', { method: 'POST', headers: { authorization: 'Bearer olivia', 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'tool', name: 'refund', spec: { tool: 'payments.refund', approval: 'none' } }) });
    expect(weaken.status).toBe(422);
  });

  it('supports RTL and keeps working at phone width', async () => {
    const { fetchImpl } = await backend();
    render(<App fetchImpl={fetchImpl} initialToken="olivia" />);
    await screen.findByRole('navigation', { name: 'Platform sections' });
    fireEvent.click(screen.getByRole('button', { name: 'RTL' }));
    await waitFor(() => expect(document.querySelector('.shell')?.getAttribute('dir')).toBe('rtl'));
    await act(async () => {
      globalThis.innerWidth = 390;
      globalThis.dispatchEvent(new Event('resize'));
      await Promise.resolve();
    });
    expect(screen.getByRole('main')).toBeTruthy();
  });
});
