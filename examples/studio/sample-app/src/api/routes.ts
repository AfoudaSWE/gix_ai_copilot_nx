import type { FastifyInstance } from 'fastify';
export enum Permissions { APPLICATION_VIEW = 'application:view', PAYMENT_VIEW = 'payment:view' }
export async function routes(app: FastifyInstance) {
  app.get('/payments/:id', async () => requirePermission(Permissions.PAYMENT_VIEW));
}
declare function requirePermission(permission: string): unknown;
export function useCurrentUser() { return { id: 'u1' }; }
