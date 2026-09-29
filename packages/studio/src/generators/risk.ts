import type { ToolActionRisk, ToolApprovalLevel } from '@gixcopilot/protocol';
import { createDefaultRiskPolicy, strongerApprovalLevel } from '@gixcopilot/security';
import { isValidToolName } from '@gixcopilot/tools';
import { isDevelopmentToolName } from '../planes.js';

const riskPolicy = createDefaultRiskPolicy();

/**
 * The initial risk suggestion (§34). Only a heuristic: HTTP method alone is not
 * authoritative, so the developer can change it before approval.
 */
export function suggestRisk(method: string): ToolActionRisk {
  switch (method.toUpperCase()) {
    case 'GET':
    case 'HEAD':
      return 'read-only';
    case 'DELETE':
      return 'destructive';
    default:
      return 'write';
  }
}

/** The approval level the existing Action Firewall's default risk policy requires (§34, §50). */
export function approvalFloor(risk: ToolActionRisk): ToolApprovalLevel {
  return riskPolicy.resolveApprovalLevel({ risk });
}

/** True when `approval` is at least as strict as the floor for `risk`. */
export function meetsApprovalFloor(risk: ToolActionRisk, approval: ToolApprovalLevel): boolean {
  return strongerApprovalLevel(approval, approvalFloor(risk)) === approval;
}

const RISK_ORDER: readonly ToolActionRisk[] = ['read-only', 'write', 'destructive'];
export function isRiskLowered(suggested: ToolActionRisk, chosen: ToolActionRisk): boolean {
  return RISK_ORDER.indexOf(chosen) < RISK_ORDER.indexOf(suggested);
}

const camel = (value: string): string =>
  value
    .replace(/[^A-Za-z0-9]+(.)?/g, (_match, next: string | undefined) => (next ? next.toUpperCase() : ''))
    .replace(/^[^A-Za-z]+/, '')
    .replace(/^./, (first) => first.toLowerCase());

const isParam = (segment: string): boolean => /^\{.+\}$/.test(segment) || segment.startsWith(':');

/**
 * A readable tool name for an operation (§33): `GET /applications` → `applications.list`,
 * `GET /applications/{id}` → `applications.get`, `POST /applications/{id}/assign` →
 * `applications.assign`. Development-plane namespaces are prefixed with `app.` so a
 * generated application tool can never take a reserved name (§4).
 */
export function toolNameFor(method: string, path: string): string {
  const segments = path.split('/').filter((segment) => segment.length > 0 && !/^(api|v\d+)$/i.test(segment));
  const literals = segments.filter((segment) => !isParam(segment)).map(camel).filter(Boolean);
  const last = segments.at(-1);
  const verb = method.toUpperCase();
  let name: string;
  const previous = segments.at(-2);
  if (last && !isParam(last) && previous && isParam(previous) && literals.length >= 2 && verb !== 'GET' && verb !== 'DELETE') {
    name = `${literals.slice(0, -1).join('.')}.${literals.at(-1) ?? 'action'}`;
  } else {
    const base = literals.length > 0 ? literals.join('.') : 'root';
    const endsWithParam = last !== undefined && isParam(last);
    const action = verb === 'GET' ? (endsWithParam ? 'get' : 'list') : verb === 'POST' ? 'create' : verb === 'DELETE' ? 'delete' : 'update';
    name = `${base}.${action}`;
  }
  if (isDevelopmentToolName(name)) name = `app.${name}`;
  return isValidToolName(name) ? name : `api.${camel(name) || 'operation'}`;
}

/** Singular upper-snake resource name: `applications` → `APPLICATION`. */
function resourceKey(path: string): string {
  const literal = path
    .split('/')
    .filter((segment) => segment.length > 0 && !isParam(segment) && !/^(api|v\d+)$/i.test(segment))
    .at(0);
  const word = (literal ?? 'resource').replace(/ies$/, 'y').replace(/(ses|xes)$/, (match) => match.slice(0, -2)).replace(/s$/, '');
  return word.replace(/[^A-Za-z0-9]+/g, '_').toUpperCase();
}

const VERB_SYNONYMS: Readonly<Record<string, readonly string[]>> = {
  GET: ['VIEW', 'READ', 'LIST', 'GET'],
  POST: ['CREATE', 'ADD', 'WRITE'],
  PUT: ['UPDATE', 'EDIT', 'WRITE'],
  PATCH: ['UPDATE', 'EDIT', 'WRITE'],
  DELETE: ['DELETE', 'REMOVE'],
};

export interface PermissionSuggestion {
  readonly permission: string;
  /** True when the permission exists in the discovered code; false when it is a new name. */
  readonly discovered: boolean;
}

/**
 * Matches an operation to a discovered permission (§22, §39): `GET /applications` →
 * `APPLICATION_VIEW`. Declared permissions on the route win. When nothing matches, a new
 * name is suggested and flagged as not discovered, so review shows it must be created.
 */
export function suggestPermission(method: string, path: string, declared: readonly string[], known: readonly string[]): PermissionSuggestion {
  const first = declared[0];
  if (first) return { permission: first, discovered: true };
  const resource = resourceKey(path);
  const verbs = VERB_SYNONYMS[method.toUpperCase()] ?? ['ACCESS'];
  const normalized = new Map(known.map((name) => [name.toUpperCase().replace(/[.:\-/]/g, '_'), name]));
  for (const verb of verbs) {
    for (const candidate of [`${resource}_${verb}`, `${resource}S_${verb}`, `${verb}_${resource}`]) {
      const match = normalized.get(candidate);
      if (match) return { permission: match, discovered: true };
    }
  }
  return { permission: `${resource}_${verbs[0] ?? 'ACCESS'}`, discovered: false };
}

export { camel as toCamelCase };
