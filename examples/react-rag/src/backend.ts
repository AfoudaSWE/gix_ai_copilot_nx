import Fastify from 'fastify';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { SecurityContext } from '@gixcopilot/security';
import type { RagService } from './service.js';

/** Development credentials are mapped to identity on the server, never taken from JSON. */
export function demoSecurityContext(token: string): SecurityContext | undefined {
  if (!['viewer', 'supervisor', 'admin'].includes(token)) return undefined;
  return { tenant: { tenantId: 'demo' }, identity: { subject: token, roles: [token],
    permissions: token === 'admin' ? ['knowledge.supervisor.read', 'knowledge.admin.read'] : token === 'supervisor' ? ['knowledge.supervisor.read'] : [] } };
}

export function createRagServer(service?: RagService): FastifyInstance {
  const app = Fastify({ bodyLimit: 32_768 });
  const identity = (request: FastifyRequest): SecurityContext => {
    const context = demoSecurityContext(request.headers.authorization?.replace(/^Bearer /, '') ?? '');
    if (!context) throw Object.assign(new Error('Choose a demo identity.'), { statusCode: 401 });
    return context;
  };
  app.setErrorHandler((error, _request, reply) => {
    const status = typeof error === 'object' && error !== null && 'statusCode' in error && typeof error.statusCode === 'number' ? error.statusCode : 400;
    return reply.status(status).send({ error: status === 503 ? 'Configure OPENAI_API_KEY and OPENAI_MODEL on the server.' : 'Request rejected. Check your identity, input or memory policy.' });
  });
  const requiredService = (): RagService => {
    if (!service) throw Object.assign(new Error('Model is not configured.'), { statusCode: 503 });
    return service;
  };
  app.get('/config', () => ({ configured: Boolean(service) }));
  app.post('/ask', async (request) => {
    const context = identity(request);
    const { text } = z.object({ text: z.string().trim().min(1).max(4000) }).strict().parse(request.body);
    return requiredService().ask(text, context, AbortSignal.timeout(90_000));
  });
  app.get('/memory', async (request) => requiredService().memory(identity(request)).search({ topK: 100 }));
  app.post('/memory', async (request) => {
    const context = identity(request);
    const { value } = z.object({ value: z.string().trim().min(1).max(2000) }).strict().parse(request.body);
    return requiredService().memory(context).save({ type: 'durable', value, provenance: 'explicit-user-save' }, true);
  });
  app.delete('/memory/:id', async (request) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    await requiredService().memory(identity(request)).forget(id);
    return { deleted: true };
  });
  return app;
}
