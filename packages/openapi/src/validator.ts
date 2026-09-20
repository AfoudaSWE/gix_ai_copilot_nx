import type { OpenAPIDocument } from './types.js';

export interface ValidationIssue {
  readonly path: string;
  readonly problem: string;
}

export type ValidationResult =
  | { readonly ok: true; readonly document: OpenAPIDocument; readonly version: '3.0' | '3.1' }
  | { readonly ok: false; readonly issues: readonly ValidationIssue[] };

/**
 * Structural validation before generation (Section 12) - deliberately does not implement a
 * full JSON Schema meta-schema validator; it checks the shape this package actually depends
 * on (a `paths` object of method -> operation records) and reports issues by source/path/
 * operation/problem, without ever including document *content* that might carry secrets in
 * `description`/`example` fields.
 */
export function validateOpenAPIDocument(value: unknown): ValidationResult {
  const issues: ValidationIssue[] = [];
  if (typeof value !== 'object' || value === null) {
    return { ok: false, issues: [{ path: '$', problem: 'Document is not an object.' }] };
  }
  const record = value as Record<string, unknown>;

  const versionField = record['openapi'];
  if (typeof versionField !== 'string') {
    issues.push({ path: '$.openapi', problem: 'Missing "openapi" version field.' });
  }
  const version = typeof versionField === 'string' && versionField.startsWith('3.1') ? '3.1' : '3.0';
  if (typeof versionField === 'string' && !/^3\.[01]\.\d+$/.test(versionField)) {
    issues.push({ path: '$.openapi', problem: `Unsupported OpenAPI version "${versionField}" - only 3.0.x and 3.1.x are supported.` });
  }

  const paths = record['paths'];
  if (paths !== undefined && (typeof paths !== 'object' || paths === null || Array.isArray(paths))) {
    issues.push({ path: '$.paths', problem: '"paths" must be an object.' });
  }

  if (paths && typeof paths === 'object' && !Array.isArray(paths)) {
    for (const [path, item] of Object.entries(paths)) {
      if (path.startsWith('x-')) continue;
      if (!path.startsWith('/') || !item || typeof item !== 'object' || Array.isArray(item)) {
        issues.push({ path: `$.paths.${path}`, problem: 'Invalid path item.' }); continue;
      }
      for (const method of ['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace']) {
        const operation = (item as Record<string, unknown>)[method];
        if (operation !== undefined && (!operation || typeof operation !== 'object' || Array.isArray(operation))) issues.push({ path: `$.paths.${path}.${method}`, problem: 'Operation must be an object.' });
      }
    }
  }
  const servers = record['servers'];
  if (servers !== undefined && (!Array.isArray(servers) || servers.some((server: unknown) => !server || typeof server !== 'object' || typeof (server as Record<string, unknown>)['url'] !== 'string'))) issues.push({ path: '$.servers', problem: 'Invalid servers array.' });
  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, document: value as OpenAPIDocument, version };
}
