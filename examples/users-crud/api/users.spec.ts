import 'reflect-metadata';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import type { INestApplication } from '@nestjs/common';
import { AppModule } from './app.module.js';

describe('users API', () => {
  let app: INestApplication;
  let directory: string;
  let base: string;
  let previousFile: string | undefined;

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'users-crud-'));
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

  it('creates, lists, updates, persists, and deletes a user', async () => {
    const create = await fetch(`${base}/api/users`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: ' Alex Morgan ', email: 'ALEX@EXAMPLE.COM', role: 'Member' }),
    });
    expect(create.status).toBe(201);
    const user = (await create.json()) as { id: string; name: string; email: string };
    expect(user).toMatchObject({ name: 'Alex Morgan', email: 'alex@example.com' });

    const list = await fetch(`${base}/api/users`);
    expect(await list.json()).toEqual([expect.objectContaining({ id: user.id })]);
    const duplicate = await fetch(`${base}/api/users`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Other', email: user.email, role: 'Viewer' }),
    });
    expect(duplicate.status).toBe(409);

    const update = await fetch(`${base}/api/users/${user.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ role: 'Admin' }),
    });
    expect(update.status).toBe(200);
    expect(await update.json()).toMatchObject({ id: user.id, role: 'Admin' });
    expect(JSON.parse(await readFile(join(directory, 'users.json'), 'utf8'))).toEqual([
      expect.objectContaining({ id: user.id, role: 'Admin' }),
    ]);

    const remove = await fetch(`${base}/api/users/${user.id}`, { method: 'DELETE' });
    expect(remove.status).toBe(204);
    expect((await fetch(`${base}/api/users/${user.id}`)).status).toBe(404);
  });

  it('rejects invalid user input', async () => {
    const response = await fetch(`${base}/api/users`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '', email: 'invalid', role: 'Owner' }),
    });
    expect(response.status).toBe(400);
  });
});
