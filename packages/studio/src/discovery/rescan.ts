import type { ApiOperation, ComponentInfo, ContextCandidate, DiscoveredProject, PermissionInfo } from './model.js';

export interface DiscoveryComparison {
  readonly newApis: readonly ApiOperation[];
  readonly changedApis: readonly ApiOperation[];
  readonly removedApis: readonly ApiOperation[];
  readonly newComponents: readonly ComponentInfo[];
  readonly changedComponents: readonly ComponentInfo[];
  readonly removedComponents: readonly ComponentInfo[];
  readonly newPermissions: readonly PermissionInfo[];
  readonly newContextCandidates: readonly ContextCandidate[];
  readonly unchanged: boolean;
}

const operationKey = (operation: ApiOperation): string => `${operation.sourceKind} ${operation.method} ${operation.path}`;
const componentKey = (component: ComponentInfo): string => `${component.framework}:${component.name}`;
const operationShape = (operation: ApiOperation): string => JSON.stringify([operation.input ?? null, operation.output ?? null, [...operation.permissions].sort(), operation.authentication ?? null]);
const componentShape = (component: ComponentInfo): string => JSON.stringify(component.props);

function diffBy<T>(previous: readonly T[], current: readonly T[], key: (value: T) => string, shape: (value: T) => string): { added: T[]; changed: T[]; removed: T[] } {
  const before = new Map(previous.map((value) => [key(value), value]));
  const after = new Map(current.map((value) => [key(value), value]));
  return {
    added: [...after].filter(([id]) => !before.has(id)).map(([, value]) => value),
    changed: [...after].filter(([id, value]) => before.has(id) && shape(before.get(id) as T) !== shape(value)).map(([, value]) => value),
    removed: [...before].filter(([id]) => !after.has(id)).map(([, value]) => value),
  };
}

/** Previous discovery vs the current repository (§61). Pure: it only compares two results. */
export function compareDiscoveries(previous: DiscoveredProject, current: DiscoveredProject): DiscoveryComparison {
  const operations = (project: DiscoveredProject): ApiOperation[] => project.apis.flatMap((source) => source.operations);
  const apis = diffBy(operations(previous), operations(current), operationKey, operationShape);
  const components = diffBy(previous.components, current.components, componentKey, componentShape);
  const knownPermissions = new Set(previous.permissions.map((permission) => permission.name));
  const knownContext = new Set(previous.contextCandidates.map((candidate) => candidate.name));
  const newPermissions = current.permissions.filter((permission) => !knownPermissions.has(permission.name));
  const newContextCandidates = current.contextCandidates.filter((candidate) => !knownContext.has(candidate.name));
  return {
    newApis: apis.added,
    changedApis: apis.changed,
    removedApis: apis.removed,
    newComponents: components.added,
    changedComponents: components.changed,
    removedComponents: components.removed,
    newPermissions,
    newContextCandidates,
    unchanged: [apis.added, apis.changed, apis.removed, components.added, components.changed, components.removed, newPermissions, newContextCandidates].every((list) => list.length === 0),
  };
}
