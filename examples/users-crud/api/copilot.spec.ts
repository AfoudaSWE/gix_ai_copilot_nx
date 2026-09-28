import 'reflect-metadata';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import type { INestApplication } from '@nestjs/common';
import { createMockProvider } from '@gixcopilot/provider-mock';
import { AppModule } from './app.module.js';
import { createUsersCopilot, LOCAL_DEV_TOKEN } from './copilot.js';
import { createUsersApi } from './users.connector.js';

const authorization = { authorization: `Bearer ${LOCAL_DEV_TOKEN}` };

function message(text: string) {
  return {
    messages: [{ role: 'user' as const, content: [{ type: 'text' as const, text }] }],
    headers: authorization,
  };
}

describe('users copilot', () => {
  let app: INestApplication;
  let directory: string;
  let base: string;
  let previousFile: string | undefined;

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'users-copilot-'));
    previousFile = process.env.USERS_DATA_FILE;
    process.env.USERS_DATA_FILE = join(directory, 'users.json');
    app = await NestFactory.create(AppModule, new FastifyAdapter(), { logger: false });
    await app.listen(0, '127.0.0.1');
    base = await app.getUrl();
  });

  afterAll(async () => {
    await app?.close();
    if (previousFile === undefined) delete process.env.USERS_DATA_FILE;
    else process.env.USERS_DATA_FILE = previousFile;
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  /** A copilot whose model requests `toolCall` first, then answers "Done.". */
  function scriptedCopilot(toolCall: { name: string; arguments: Record<string, unknown> }) {
    return createUsersCopilot({
      apiUrl: base,
      provider: {
        model: { provider: 'scripted', model: 'demo' },
        provider: createMockProvider({
          id: 'scripted',
          scenario: (attempt) =>
            attempt === 1
              ? { toolCalls: [{ id: 'call-1', ...toolCall }] }
              : { chunks: ['Done.'] },
        }),
      },
    });
  }

  it('exposes exactly the declared endpoints as tools', () => {
    expect(
      createUsersApi(base)
        .tools.map((tool) => tool.name)
        .sort(),
    ).toEqual(['users.create', 'users.delete', 'users.get', 'users.list', 'users.update']);
  });

  it('creates a user only after the requester confirms in the chat', async () => {
    const { copilot, audit } = scriptedCopilot({
      name: 'users.create',
      arguments: { name: 'Sam Lee', email: 'SAM@example.com', role: 'Viewer' },
    });
    try {
      const types: string[] = [];
      for await (const event of copilot.stream(message('Add Sam Lee as a Viewer'))) {
        types.push(event.type);
        if (event.type !== 'approval.requested') continue;
        expect(await (await fetch(`${base}/api/users`)).json()).toEqual([]);
        const decision = await copilot.app.inject({
          method: 'POST',
          url: `/approvals/${event.approvalId}/approve`,
          headers: authorization,
        });
        expect(decision.statusCode).toBe(200);
      }
      expect(types).toEqual(
        expect.arrayContaining(['approval.requested', 'tool.completed', 'run.completed']),
      );
      expect(JSON.parse(await readFile(join(directory, 'users.json'), 'utf8'))).toEqual([
        expect.objectContaining({ name: 'Sam Lee', email: 'sam@example.com', role: 'Viewer' }),
      ]);
      expect(audit.list().map((record) => record.decision)).toContain('execution.completed');
    } finally {
      await copilot.close();
    }
  });

  it('runs read-only tools without a confirmation', async () => {
    const { copilot } = scriptedCopilot({ name: 'users.list', arguments: {} });
    try {
      const result = await copilot.run(message('Who is in the directory?'));
      expect(result.status).toBe('completed');
      expect(result.events.map((event) => event.type)).toContain('tool.completed');
      expect(result.events.map((event) => event.type)).not.toContain('approval.requested');
    } finally {
      await copilot.close();
    }
  });

  it('does not run tools for an unauthenticated caller', async () => {
    const { copilot, audit } = scriptedCopilot({ name: 'users.list', arguments: {} });
    try {
      const result = await copilot.run('Who is in the directory?');
      expect(result.events.map((event) => event.type)).not.toContain('tool.completed');
      expect(audit.list().map((record) => record.decision)).not.toContain('execution.completed');
    } finally {
      await copilot.close();
    }
  });

  it('falls back to a labelled mock provider without OPENAI_API_KEY', async () => {
    const { copilot } = createUsersCopilot({ apiUrl: base, env: {} });
    try {
      const result = await copilot.run(message('Who are the admins?'));
      expect(result.status).toBe('completed');
      expect(result.text).toContain('OPENAI_API_KEY');
    } finally {
      await copilot.close();
    }
  });
});
