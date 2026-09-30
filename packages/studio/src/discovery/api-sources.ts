import type * as TS from 'typescript';
import { hasExportModifier, lineOf, parseSource } from './ast.js';
import type { TypeScriptApi } from './ast.js';
import type { ApiOperation } from './model.js';

type Method = ApiOperation['method'];
const METHODS: readonly Method[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const asMethod = (value: unknown): Method | undefined => {
  const upper = typeof value === 'string' ? value.toUpperCase() : '';
  return METHODS.find((method) => method === upper);
};

/**
 * A Swagger 2.0 document (§16-17). Reads paths, operationId, summary, path/query parameters,
 * the body parameter's schema and the success response schema. `$ref`s must already be resolved.
 */
export function parseSwagger2(file: string, document: Record<string, unknown>): { title?: string; operations: ApiOperation[] } {
  const info = isRecord(document['info']) ? document['info'] : {};
  const title = typeof info['title'] === 'string' ? info['title'] : undefined;
  const basePath = typeof document['basePath'] === 'string' && document['basePath'] !== '/' ? document['basePath'].replace(/\/$/, '') : '';
  const globalSecurity = Array.isArray(document['security']) && document['security'].length > 0;
  const operations: ApiOperation[] = [];
  for (const [path, item] of Object.entries(isRecord(document['paths']) ? document['paths'] : {})) {
    if (!isRecord(item)) continue;
    const shared: unknown[] = Array.isArray(item['parameters']) ? item['parameters'] : [];
    for (const [key, operation] of Object.entries(item)) {
      const method = asMethod(key);
      if (!method || !isRecord(operation)) continue;
      const properties: Record<string, unknown> = {};
      const required: string[] = [];
      const parameters: unknown[] = Array.isArray(operation['parameters']) ? operation['parameters'] : [];
      for (const parameter of [...shared, ...parameters]) {
        if (!isRecord(parameter) || typeof parameter['name'] !== 'string') continue;
        const location = parameter['in'];
        if (location === 'body') {
          properties['body'] = isRecord(parameter['schema']) ? parameter['schema'] : { type: 'object' };
          if (parameter['required'] === true) required.push('body');
        } else if (location === 'path' || location === 'query') {
          properties[parameter['name']] = { type: typeof parameter['type'] === 'string' ? parameter['type'] : 'string' };
          if (parameter['required'] === true || location === 'path') required.push(parameter['name']);
        }
      }
      const responses = isRecord(operation['responses']) ? operation['responses'] : {};
      const success = Object.keys(responses).find((status) => /^2\d\d$/.test(status));
      const successSchema = success && isRecord(responses[success]) ? responses[success]['schema'] : undefined;
      const extension = operation['x-permissions'] ?? operation['x-required-permissions'];
      const fullPath = `${basePath}${path}`;
      operations.push({
        id: `${method} ${fullPath} @ ${file}`,
        method,
        path: fullPath,
        ...(typeof operation['operationId'] === 'string' ? { operationId: operation['operationId'] } : {}),
        ...(typeof operation['summary'] === 'string' ? { summary: operation['summary'] } : {}),
        input: { type: 'object', properties, ...(required.length > 0 ? { required } : {}) },
        ...(isRecord(successSchema) ? { output: successSchema } : {}),
        ...(globalSecurity || (Array.isArray(operation['security']) && operation['security'].length > 0) ? { authentication: 'declared' } : {}),
        permissions: Array.isArray(extension) ? extension.filter((value): value is string => typeof value === 'string') : [],
        source: title ?? file,
        sourceKind: 'swagger',
        file,
      });
    }
  }
  return { ...(title ? { title } : {}), operations };
}

export function isPostmanCollection(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value) || !Array.isArray(value['item'])) return false;
  const info = value['info'];
  return isRecord(info) && (typeof info['_postman_id'] === 'string' || (typeof info['schema'] === 'string' && info['schema'].includes('postman')));
}

/** Postman `url` → path template: `{{baseUrl}}/users/:id` becomes `/users/{id}`. */
function postmanPath(url: unknown): string | undefined {
  let raw: string | undefined;
  if (typeof url === 'string') raw = url;
  else if (isRecord(url)) {
    if (Array.isArray(url['path'])) raw = `/${url['path'].map((segment) => (typeof segment === 'string' ? segment : isRecord(segment) && typeof segment['value'] === 'string' ? segment['value'] : '')).join('/')}`;
    else if (typeof url['raw'] === 'string') raw = url['raw'];
  }
  if (!raw) return undefined;
  const path = raw
    .replace(/^\{\{[^}]+\}\}/, '')
    .replace(/^https?:\/\/[^/]+/, '')
    .replace(/\?.*$/, '')
    .replace(/:([A-Za-z_]\w*)/g, '{$1}')
    .replace(/\{\{([A-Za-z_]\w*)\}\}/g, '{$1}');
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return /[A-Za-z]/.test(normalized) ? normalized.replace(/\/+$/, '') || '/' : undefined;
}

/** Infers a shallow JSON Schema from an example value. Examples are hints, never authoritative. */
function schemaFromExample(value: unknown, depth = 0): Record<string, unknown> {
  if (depth > 4) return {};
  if (Array.isArray(value)) return { type: 'array', items: value.length > 0 ? schemaFromExample(value[0], depth + 1) : {} };
  if (isRecord(value)) return { type: 'object', properties: Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, schemaFromExample(entry, depth + 1)])) };
  if (typeof value === 'number') return { type: Number.isInteger(value) ? 'integer' : 'number' };
  if (typeof value === 'boolean') return { type: 'boolean' };
  return { type: 'string' };
}

/**
 * A Postman v2.x collection (§18): folders, requests, methods, URL variables, query params,
 * auth headers and JSON bodies become operation candidates. A request body example yields only
 * a hinted schema, so a stronger source (OpenAPI, Swagger, routes) wins when both exist.
 */
export function parsePostman(file: string, collection: Record<string, unknown>): { title?: string; operations: ApiOperation[] } {
  const info = isRecord(collection['info']) ? collection['info'] : {};
  const title = typeof info['name'] === 'string' ? info['name'] : undefined;
  const collectionAuth = isRecord(collection['auth']);
  const operations: ApiOperation[] = [];
  const visit = (items: unknown[], folder: string[]): void => {
    for (const item of items) {
      if (!isRecord(item)) continue;
      if (Array.isArray(item['item'])) {
        visit(item['item'], [...folder, typeof item['name'] === 'string' ? item['name'] : 'folder']);
        continue;
      }
      const request = item['request'];
      if (!isRecord(request) && typeof request !== 'string') continue;
      const method = asMethod(isRecord(request) ? (request['method'] ?? 'GET') : 'GET');
      const path = postmanPath(isRecord(request) ? request['url'] : request);
      if (!method || !path) continue;
      const properties: Record<string, unknown> = Object.fromEntries([...path.matchAll(/\{([^}]+)\}/g)].map((match) => [match[1] ?? 'param', { type: 'string' }]));
      const url = isRecord(request) ? request['url'] : undefined;
      if (isRecord(url) && Array.isArray(url['query'])) {
        for (const query of url['query']) if (isRecord(query) && typeof query['key'] === 'string') properties[query['key']] = { type: 'string' };
      }
      const body = isRecord(request) && isRecord(request['body']) ? request['body'] : undefined;
      if (body?.['mode'] === 'raw' && typeof body['raw'] === 'string') {
        try {
          properties['body'] = schemaFromExample(JSON.parse(body['raw']) as unknown);
        } catch {
          properties['body'] = { type: 'object' };
        }
      }
      const headers = isRecord(request) && Array.isArray(request['header']) ? request['header'] : [];
      const authenticated = collectionAuth || (isRecord(request) && isRecord(request['auth'])) || headers.some((header) => isRecord(header) && typeof header['key'] === 'string' && header['key'].toLowerCase() === 'authorization');
      const name = typeof item['name'] === 'string' ? item['name'] : undefined;
      operations.push({
        id: `${method} ${path} @ ${file}#${[...folder, name ?? ''].join('/')}`,
        method,
        path,
        ...(name ? { summary: [...folder, name].join(' / ') } : {}),
        input: { type: 'object', properties, required: [...path.matchAll(/\{([^}]+)\}/g)].map((match) => match[1] ?? 'param') },
        ...(authenticated ? { authentication: 'declared' } : {}),
        permissions: [],
        source: title ?? file,
        sourceKind: 'postman',
        file,
      });
    }
  };
  visit(collection['item'] as unknown[], []);
  return { ...(title ? { title } : {}), operations };
}

/** `app/(shop)/orders/[id]/route.ts` → `/orders/{id}`; `pages/api/users/[id].ts` → `/api/users/{id}`. */
export function nextRoutePath(file: string): { readonly kind: 'app-page' | 'app-route' | 'pages-api' | 'pages-page'; readonly path: string } | undefined {
  const segmentPath = (segments: readonly string[]): string =>
    `/${segments
      .filter((segment) => !/^\(.*\)$/.test(segment) && !segment.startsWith('@'))
      .map((segment) => segment.replace(/^\[\[?\.\.\.(\w+)\]?\]$/, '{$1}').replace(/^\[(\w+)\]$/, '{$1}'))
      .join('/')}`.replace(/\/+$/, '') || '/';
  const app = /(?:^|\/)app\/(.*?)\/?(page|route)\.[cm]?[jt]sx?$/.exec(file);
  if (app) return { kind: app[2] === 'route' ? 'app-route' : 'app-page', path: segmentPath((app[1] ?? '').split('/').filter(Boolean)) };
  const pages = /(?:^|\/)pages\/(.+)\.[cm]?[jt]sx?$/.exec(file);
  if (pages) {
    const segments = (pages[1] ?? '').split('/').filter((segment) => segment !== 'index');
    if (segments[0]?.startsWith('_')) return undefined;
    return { kind: segments[0] === 'api' ? 'pages-api' : 'pages-page', path: segmentPath(segments) };
  }
  return undefined;
}

/** HTTP methods exported by an app-router route handler (`export async function GET`). */
export function nextRouteHandlerMethods(ts: TypeScriptApi, file: string, text: string): { readonly method: Method; readonly line: number }[] {
  const source = parseSource(ts, file, text);
  const found: { method: Method; line: number }[] = [];
  const add = (name: string, node: TS.Node): void => {
    const method = asMethod(name);
    if (method && name === method) found.push({ method, line: lineOf(source, node) });
  };
  for (const statement of source.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name && hasExportModifier(ts, statement)) add(statement.name.text, statement);
    if (ts.isVariableStatement(statement) && hasExportModifier(ts, statement)) {
      for (const declaration of statement.declarationList.declarations) if (ts.isIdentifier(declaration.name)) add(declaration.name.text, declaration);
    }
  }
  return found;
}

/** Methods a pages-router API handler checks (`req.method === 'POST'`); GET when none. */
export function pagesApiMethods(text: string): Method[] {
  const methods = [...text.matchAll(/method\s*===?\s*['"](GET|POST|PUT|PATCH|DELETE)['"]/g)].map((match) => match[1] as Method);
  const cases = [...text.matchAll(/case\s+['"](GET|POST|PUT|PATCH|DELETE)['"]/g)].map((match) => match[1] as Method);
  const all = [...new Set([...methods, ...cases])];
  return all.length > 0 ? all : ['GET'];
}
