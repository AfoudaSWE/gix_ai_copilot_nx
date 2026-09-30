import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';

export function createFixture(files: Readonly<Record<string, string>>): string {
  const root = mkdtempSync(join(tmpdir(), 'gix-studio-'));
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return root;
}

export function removeFixture(root: string): void {
  rmSync(root, { recursive: true, force: true });
}

/** Path → SHA-256 of every file (including ignored and secret ones), to prove nothing changed. */
export function snapshot(root: string): Record<string, string> {
  const result: Record<string, string> = {};
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) walk(path);
      else result[relative(root, path).split('\\').join('/')] = createHash('sha256').update(readFileSync(path)).digest('hex');
    }
  };
  walk(root);
  return result;
}

const OPENAPI = `openapi: 3.0.3
info:
  title: Applications API
  version: 1.0.0
servers:
  - url: https://api.example.test
paths:
  /applications:
    get:
      operationId: listApplications
      summary: List applications
      x-permissions: [APPLICATION_VIEW]
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema:
                type: array
                items: { type: object, properties: { id: { type: string } } }
    post:
      operationId: createApplication
      summary: Create an application
      requestBody:
        required: true
        content:
          application/json:
            schema: { type: object, properties: { name: { type: string } }, required: [name] }
      responses:
        '201': { description: Created }
  /applications/{id}:
    parameters:
      - { name: id, in: path, required: true, schema: { type: string } }
    get:
      operationId: getApplication
      summary: Get an application
      responses:
        '200': { description: OK }
    put:
      operationId: updateApplication
      summary: Update an application
      requestBody:
        content:
          application/json:
            schema: { type: object, properties: { name: { type: string } } }
      responses:
        '200': { description: OK }
    delete:
      operationId: deleteApplication
      summary: Delete an application
      responses:
        '204': { description: Deleted }
`;

/** An Nx workspace with a React app, a Fastify API, a UI library, OpenAPI and docs. */
export const NX_FIXTURE: Readonly<Record<string, string>> = {
  'package.json': JSON.stringify({ name: 'customer-portal', private: true, scripts: { typecheck: 'nx run-many -t typecheck', lint: 'nx run-many -t lint', test: 'nx run-many -t test', build: 'nx run-many -t build' }, dependencies: { react: '^19.0.0', fastify: '^5.0.0', '@gixcopilot/react': '0.2.2', '@fastify/jwt': '^9.0.0' }, devDependencies: { nx: '21.0.0', typescript: '5.9.3', vitest: '5.0.1', vite: '8.0.0' } }),
  'pnpm-lock.yaml': 'lockfileVersion: 9.0\n',
  'nx.json': '{}',
  'tsconfig.base.json': '{}',
  '.gitignore': 'generated/\n*.log\n',
  '.env': 'OPENAI_API_KEY=sk-proj-THIS_IS_A_FAKE_SECRET_VALUE_1234567890\n',
  'README.md': '# Customer Portal\n\nThe portal.\n',
  'docs/payments/guide.md': '# Payments guide\n',
  'docs/appointments/faq.md': '# Appointments FAQ\n',
  'openapi.yaml': OPENAPI,
  'node_modules/leftpad/index.js': "app.get('/should-not-be-found', handler);\n",
  'dist/main.js': "app.get('/built-output', handler);\n",
  'generated/client.ts': "export const ignored = fetch('/ignored-by-gitignore');\n",
  'server.log': 'noise',
  'apps/web/project.json': JSON.stringify({ name: 'web', projectType: 'application' }),
  'apps/web/src/main.tsx': `import { createBrowserRouter } from 'react-router';
export const router = createBrowserRouter([{ path: '/', element: null }, { path: '/applications/:id', element: null }]);
`,
  'apps/web/src/api/applications.ts': `import axios from 'axios';
export const listApplications = () => axios.get('/api/applications');
export const getPayment = (id: string) => fetch(\`/api/payments/\${id}/status\`);
export const cancelAppointment = (id: string) => fetch('/api/appointments/' + id, { method: 'DELETE' });
export const token = () => localStorage.getItem('auth_token');
`,
  'apps/web/src/state/session.ts': `export function useCurrentUser() { return { id: 'u1' }; }
export function useTenant() { return 't1'; }
export const selectedApplication = { id: 'a1' };
export function usePermissions() { return [] as string[]; }
`,
  'apps/api/project.json': JSON.stringify({ name: 'api', projectType: 'application' }),
  'apps/api/src/routes.ts': `import type { FastifyInstance } from 'fastify';
import { Permissions } from './permissions';
export async function routes(app: FastifyInstance) {
  app.get('/applications', { preHandler: app.authenticate }, async () => requirePermission(Permissions.APPLICATION_VIEW));
  app.post('/applications', async () => requirePermission(Permissions.APPLICATION_CREATE));
  app.get('/payments/:id/status', async () => ({}));
  app.route({ method: 'DELETE', url: '/appointments/:id', preHandler: verifyJwt, handler: async () => ({}) });
}
declare function requirePermission(permission: string): unknown;
declare const verifyJwt: unknown;
`,
  'apps/api/src/permissions.ts': `export enum Permissions {
  APPLICATION_VIEW = 'application:view',
  APPLICATION_CREATE = 'application:create',
  APPLICATION_UPDATE = 'application:update',
  APPLICATION_DELETE = 'application:delete',
}
export const PAYMENT_VIEW = 'payment:view';
export interface User { id: string; roles: string[] }
`,
  'apps/api/src/routes.spec.ts': "it('works', () => undefined);\n",
  'libs/ui/project.json': JSON.stringify({ name: 'ui', projectType: 'library' }),
  'libs/ui/src/PaymentStatusCard.tsx': `export interface PaymentStatusCardProps { paymentId: string; amount: number; status: 'paid' | 'pending' | 'failed'; note?: string }
export function PaymentStatusCard({ paymentId, amount, status }: PaymentStatusCardProps) {
  return <div>{paymentId} {amount} {status}</div>;
}
export const AppLayout = ({ children }: { children: unknown }) => <main>{String(children)}</main>;
export function ActionButton(props: { label: string; onClick: () => void }) { return <button>{props.label}</button>; }
function InternalBadge(props: { text: string }) { return <span>{props.text}</span>; }
export const used = InternalBadge;
`,
};

export const ANGULAR_FIXTURE: Readonly<Record<string, string>> = {
  'package.json': JSON.stringify({ name: 'ng-app', scripts: { start: 'ng serve', test: 'ng test' }, dependencies: { '@angular/core': '^21.0.0', '@angular/router': '^21.0.0' }, devDependencies: { typescript: '5.9.3', '@angular/cli': '^21.0.0' } }),
  'package-lock.json': '{}',
  'angular.json': '{}',
  'tsconfig.json': '{}',
  'src/app/app.routes.ts': `import type { Routes } from '@angular/router';
export const routes: Routes = [{ path: 'applications', component: ApplicationListComponent }, { path: 'applications/:id', loadComponent: () => import('./x') }];
declare const ApplicationListComponent: unknown;
`,
  'src/app/application-summary.component.ts': `import { Component, Input, input } from '@angular/core';
@Component({ selector: 'app-application-summary', template: '' })
export class ApplicationSummaryComponent {
  @Input() title!: string;
  readonly count = input.required<number>();
}
`,
  'src/app/applications.service.ts': `import { HttpClient } from '@angular/common/http';
import { ActivatedRoute } from '@angular/router';
export class ApplicationsService {
  currentUser = { id: 'u' };
  constructor(private http: HttpClient, private route: ActivatedRoute) {}
  list() { return this.http.get('/api/applications'); }
  save(id: string, body: unknown) { return this.http.put(\`/api/applications/\${id}\`, body); }
}
`,
};

export const VUE_FIXTURE: Readonly<Record<string, string>> = {
  'package.json': JSON.stringify({ name: 'vue-app', scripts: { dev: 'vite' }, dependencies: { vue: '^3.5.0', axios: '^1.0.0', pinia: '^3.0.0' }, devDependencies: { vite: '8.0.0' } }),
  'yarn.lock': '',
  'src/components/AppointmentList.vue': `<script setup lang="ts">
const props = defineProps<{ appointments: string[]; title: string; compact?: boolean }>();
</script>
<template><ul><li v-for="a in props.appointments">{{ a }}</li></ul></template>
`,
  'src/api.js': `import axios from 'axios';
export const loadAppointments = () => axios.get('/api/appointments');
`,
  'src/stores/session.js': `import { defineStore } from 'pinia';
export const useSessionStore = defineStore('session', {});
`,
};

export const EXPRESS_NEST_FIXTURE: Readonly<Record<string, string>> = {
  'package.json': JSON.stringify({ name: 'backend', scripts: { start: 'node dist/main.js', build: 'tsc' }, dependencies: { express: '^5.0.0', '@nestjs/core': '^11.0.0', passport: '^0.7.0' }, devDependencies: { typescript: '5.9.3', jest: '^30.0.0' } }),
  'package-lock.json': '{}',
  'tsconfig.json': '{}',
  'src/express.ts': `import express from 'express';
const router = express.Router();
router.get('/customers', requireAuth, (_req, res) => res.json([]));
router.delete('/customers/:id', requireAuth, requirePermission('CUSTOMER_DELETE'), (_req, res) => res.end());
declare function requireAuth(): void;
declare function requirePermission(name: string): () => void;
export default router;
`,
  'src/customers.controller.ts': `import { Controller, Get, Post, UseGuards } from '@nestjs/common';
@Controller('customers')
@UseGuards(AuthGuard)
export class CustomersController {
  @Get(':id') get() { return {}; }
  @Post() create() { return {}; }
}
declare const AuthGuard: unknown;
`,
};

/** The brief's §36 example: Nx, a React portal, a Fastify API, and several API descriptions. */
export const PORTAL_FIXTURE: Readonly<Record<string, string>> = {
  'package.json': JSON.stringify({ name: 'visa-workspace', private: true, dependencies: { react: '^19.0.0', 'react-router': '^7.0.0', fastify: '^5.0.0', axios: '^1.0.0' }, devDependencies: { nx: '21.0.0', typescript: '5.9.3', vite: '8.0.0' } }),
  'package-lock.json': '{}',
  'nx.json': '{}',
  'apps/portal/project.json': JSON.stringify({ name: 'portal', projectType: 'application' }),
  'apps/portal/package.json': JSON.stringify({ name: 'portal', private: true, scripts: { dev: 'vite' }, dependencies: { react: '^19.0.0', 'react-router': '^7.0.0', axios: '^1.0.0' } }),
  'apps/portal/src/main.tsx': `import { createRoot } from 'react-dom/client';
import { App } from './app/App';
createRoot(document.getElementById('root')!).render(<App />);
`,
  'apps/portal/src/app/App.tsx': `import { Route, Routes } from 'react-router';
import { ApplicationDetails } from '../pages/ApplicationDetails';
import { Dashboard } from '../pages/Dashboard';
export function App() {
  return (
    <Routes>
      <Route path="/dashboard" element={<Dashboard />} />
      <Route path="/applications/:id" element={<ApplicationDetails />} />
      <Route path="/payments" element={<div />} />
    </Routes>
  );
}
`,
  'apps/portal/src/pages/Dashboard.tsx': `export function Dashboard() { return <h1>Dashboard</h1>; }
`,
  'apps/portal/src/pages/ApplicationDetails.tsx': `import { getApplication, getDocuments } from '../services/applications';
import { getPaymentStatus } from '../services/payments';
export function ApplicationDetails(props: { id: string }) {
  void getApplication(props.id); void getDocuments(props.id); void getPaymentStatus(props.id);
  return <section>Application</section>;
}
`,
  'apps/portal/src/services/applications.ts': `import axios from 'axios';
export const getApplication = (id: string) => axios.get(\`/api/applications/\${id}\`);
export const getDocuments = (id: string) => axios.get(\`/api/applications/\${id}/documents\`);
export const listApplications = () => axios.get('/api/applications');
`,
  'apps/portal/src/services/payments.ts': `export const getPaymentStatus = (applicationId: string) => fetch(\`/api/payments/\${applicationId}\`);
`,
  'apps/api/project.json': JSON.stringify({ name: 'api', projectType: 'application' }),
  'apps/api/package.json': JSON.stringify({ name: 'api', private: true, scripts: { start: 'node dist/main.js' }, dependencies: { fastify: '^5.0.0' } }),
  'apps/api/src/routes.ts': `export async function routes(app: any) {
  app.get('/applications', async () => []);
  app.get('/applications/:id', async () => ({}));
  app.patch('/applications/:id', async () => ({}));
}
`,
  'apis/application-api.yaml': `openapi: 3.0.3
info: { title: Application API, version: 1.0.0 }
paths:
  /applications:
    get: { operationId: listApplications, summary: List applications, responses: { '200': { description: OK } } }
    post:
      operationId: createApplication
      requestBody: { content: { application/json: { schema: { type: object, properties: { name: { type: string } } } } } }
      responses: { '201': { description: Created } }
  /applications/{id}:
    parameters: [{ name: id, in: path, required: true, schema: { type: string } }]
    get: { operationId: getApplication, summary: Get an application, responses: { '200': { description: OK } } }
    patch:
      operationId: updateApplication
      requestBody: { content: { application/json: { schema: { type: object, properties: { status: { type: string } } } } } }
      responses: { '200': { description: OK } }
    delete: { operationId: deleteApplication, responses: { '204': { description: Deleted } } }
  /applications/{id}/documents:
    parameters: [{ name: id, in: path, required: true, schema: { type: string } }]
    get: { operationId: getApplicationDocuments, responses: { '200': { description: OK } } }
`,
  'apis/payments.swagger.json': JSON.stringify({ swagger: '2.0', info: { title: 'Payments API', version: '1' }, basePath: '/', paths: { '/payments/{applicationId}': { get: { operationId: 'getPaymentStatus', summary: 'Payment status', parameters: [{ name: 'applicationId', in: 'path', required: true, type: 'string' }], responses: { '200': { description: 'OK' } } } } } }),
  'postman/Admin API.postman_collection.json': JSON.stringify({
    info: { _postman_id: 'x', name: 'Admin API', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
    auth: { type: 'bearer' },
    item: [
      { name: 'Applications', item: [{ name: 'Update application', request: { method: 'PATCH', url: { raw: '{{baseUrl}}/applications/:id', path: ['applications', ':id'] }, body: { mode: 'raw', raw: '{"state":"approved"}' } } }] },
      { name: 'Reset system', request: { method: 'POST', url: '{{baseUrl}}/system/reset' } },
    ],
  }),
};

/** A repository with separate client/ and server/ apps and no workspaces (§8). */
export const FULL_STACK_FIXTURE: Readonly<Record<string, string>> = {
  'package.json': JSON.stringify({ name: 'shop', private: true }),
  'client/package.json': JSON.stringify({ name: 'client', scripts: { dev: 'vite' }, dependencies: { vue: '^3.5.0' }, devDependencies: { vite: '8.0.0' } }),
  'client/src/App.vue': '<script setup lang="ts">\n</script>\n<template><main /></template>\n',
  'server/package.json': JSON.stringify({ name: 'server', scripts: { start: 'node index.js' }, dependencies: { express: '^5.0.0' } }),
  'server/index.js': "import express from 'express';\nconst app = express();\napp.get('/orders', (_req, res) => res.json([]));\n",
};

/** A Next.js app-router project: pages and route handlers are file-system routes. */
export const NEXT_FIXTURE: Readonly<Record<string, string>> = {
  'package.json': JSON.stringify({ name: 'next-app', scripts: { dev: 'next dev' }, dependencies: { next: '^16.0.0', react: '^19.0.0' }, devDependencies: { typescript: '5.9.3' } }),
  'next.config.ts': 'export default {};\n',
  'app/page.tsx': 'export default function Home() { return <main />; }\n',
  'app/(shop)/orders/[id]/page.tsx': 'export default function Order() { return <main />; }\n',
  'app/api/orders/route.ts': 'export async function GET() { return Response.json([]); }\nexport async function POST() { return Response.json({}); }\n',
  'app/api/orders/[id]/route.ts': 'export const DELETE = async () => new Response(null);\n',
  'pages/api/health.ts': "export default function handler(req: any, res: any) { if (req.method === 'POST') return res.end(); res.end(); }\n",
};
