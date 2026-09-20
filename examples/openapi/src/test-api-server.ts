import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

export interface Application {
  readonly applicationId: string;
  readonly applicantName: string;
  readonly status: 'PENDING' | 'APPROVED' | 'REJECTED';
  readonly assignedOfficerId?: string;
}

/**
 * A small in-memory "VAS-like" master-data API (Section 65-66) - realistic enough to exercise
 * every generation path (`GET`/`POST`/`PATCH`/`DELETE`, path + query params, a JSON request
 * body) without depending on real enterprise infrastructure being available (Section 66's "do
 * not make Phase 8 depend on external enterprise infrastructure").
 */
const seedApplications: Application[] = [
  { applicationId: 'APP-1001', applicantName: 'Ada Lovelace', status: 'PENDING' },
  { applicationId: 'APP-1002', applicantName: 'Grace Hopper', status: 'APPROVED', assignedOfficerId: 'OFF-1' },
  { applicationId: 'APP-1003', applicantName: 'Alan Turing', status: 'REJECTED' },
];

export function createTestApiServer(): FastifyInstance {
  const app = Fastify({ logger: false });
  const applications = new Map(seedApplications.map((application) => [application.applicationId, application]));

  app.get('/applications/:id', (request, reply) => {
    const { id } = request.params as { id: string };
    const application = applications.get(id);
    if (!application) return reply.code(404).send({ message: `Application "${id}" was not found.` });
    return application;
  });

  app.get('/applications', (request) => {
    const { status } = request.query as { status?: string };
    const results = Array.from(applications.values()).filter(
      (application) => status === undefined || application.status === status,
    );
    return { results };
  });

  app.post('/applications/:id/assign', (request, reply) => {
    const { id } = request.params as { id: string };
    const { officerId } = request.body as { officerId: string };
    const application = applications.get(id);
    if (!application) return reply.code(404).send({ message: `Application "${id}" was not found.` });
    const updated: Application = { ...application, assignedOfficerId: officerId };
    applications.set(id, updated);
    return updated;
  });

  app.patch('/applications/:id', (request, reply) => {
    const { id } = request.params as { id: string };
    const { status } = request.body as { status?: Application['status'] };
    const application = applications.get(id);
    if (!application) return reply.code(404).send({ message: `Application "${id}" was not found.` });
    const updated: Application = { ...application, status: status ?? application.status };
    applications.set(id, updated);
    return updated;
  });

  app.delete('/applications/:id', (request, reply) => {
    const { id } = request.params as { id: string };
    if (!applications.delete(id)) return reply.code(404).send({ message: `Application "${id}" was not found.` });
    return reply.code(204).send();
  });

  return app;
}
