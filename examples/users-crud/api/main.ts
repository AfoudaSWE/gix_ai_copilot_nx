import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { AppModule } from './app.module.js';
import { createUsersCopilot } from './copilot.js';

function portFrom(name: string, fallback: string): number {
  const port = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error(`${name} must be a valid TCP port`);
  return port;
}

async function main(): Promise<void> {
  const app = await NestFactory.create(AppModule, new FastifyAdapter());
  app.enableShutdownHooks();
  const port = portFrom('PORT', '4319');
  const copilotPort = portFrom('COPILOT_PORT', '4325');
  await app.listen(port, '127.0.0.1');

  const { copilot } = createUsersCopilot({ apiUrl: `http://127.0.0.1:${port}` });
  await copilot.listen({ host: '127.0.0.1', port: copilotPort });
  for (const signal of ['SIGINT', 'SIGTERM'] as const)
    process.once(signal, () => {
      void copilot.close();
    });
}

await main();
