import type { ContextCandidate, ContextCandidateKind } from '../discovery/model.js';
import type { ConfigChange, ContextProposal, GenerativeUIProposal, PolicyProposal, ProposalItems, ProposalWarning } from '../proposals/model.js';
import { GENERATED_ROOT, header, identifier, str, zodFromTypeText } from './codegen.js';
import { EMPTY_DRAFT } from './draft.js';
import type { Generator, RenderedFile } from './contract.js';
import { approvalFloor, suggestRisk, toolNameFor } from './risk.js';

const selectedOnly = <T extends { readonly selected: boolean }>(items: readonly T[]): T[] => items.filter((item) => item.selected);
const pick = <T>(all: readonly T[], select: readonly string[] | undefined, key: (value: T) => string): T[] => (select && select.length > 0 ? all.filter((value) => select.includes(key(value))) : [...all]);

// --- State → Context (§37) ----------------------------------------------------------------

const CONTEXT_SCOPE: Readonly<Record<ContextCandidateKind, string>> = { user: 'user', permissions: 'user', tenant: 'application', route: 'page', entity: 'page', state: 'application' };
const CONTEXT_SENSITIVITY: Readonly<Record<ContextCandidateKind, ContextProposal['sensitivity']>> = { user: 'sensitive', permissions: 'internal', tenant: 'internal', route: 'public', entity: 'internal', state: 'internal' };

export const contextGenerator: Generator<readonly ContextCandidate[]> = {
  id: 'state-context',
  title: 'State → Context',
  description: 'Proposes application context sources for @gixcopilot/context from discovered state.',
  analyze: (context, input) => Promise.resolve(pick(context.discovery.contextCandidates, input.select, (candidate) => candidate.name)),
  generate(candidates) {
    const context = candidates.map((candidate): ContextProposal => ({
      id: `context:${candidate.name}`,
      selected: candidate.kind !== 'state',
      name: candidate.name.replace(/^use(?=[A-Z])/, '').replace(/^./, (first) => first.toLowerCase()),
      kind: candidate.kind,
      description: `${candidate.kind} context (${candidate.evidence} in ${candidate.file}${candidate.line ? `:${String(candidate.line)}` : ''}).`,
      sensitivity: CONTEXT_SENSITIVITY[candidate.kind],
      source: { file: candidate.file, ...(candidate.line ? { line: candidate.line } : {}) },
    }));
    return Promise.resolve({ ...EMPTY_DRAFT, title: `State → Context: ${String(context.length)} candidate(s)`, context });
  },
  render(items) {
    const selected = selectedOnly(items.context);
    if (selected.length === 0) return Promise.resolve([]);
    const sources = selected.map((item) => `  { id: ${str(`app.${item.name}`)}, name: ${str(item.name)}, description: ${str(item.description)}, scope: ${str(CONTEXT_SCOPE[item.kind])}, sensitivity: ${str(item.sensitivity)} },`);
    const content = `${header('State → Context', 'Context the copilot may see, once your app supplies the values.')}import type { ContextRegistration, ContextRegistry, ContextScope, ContextSensitivity } from '@gixcopilot/context';

export const applicationContextSources = [
${sources.join('\n')}
] as const satisfies readonly { id: string; name: string; description: string; scope: ContextScope; sensitivity: ContextSensitivity }[];

export type ApplicationContextId = (typeof applicationContextSources)[number]['id'];

/**
 * Registers the reviewed sources with values from your application state. Pass only what
 * the model may see; sensitivity metadata is not an authorization mechanism.
 */
export function registerApplicationContext(registry: ContextRegistry, values: Partial<Record<ApplicationContextId, unknown>>): ContextRegistration[] {
  return applicationContextSources
    .filter((source) => values[source.id] !== undefined)
    .map((source) => registry.register({ ...source, value: values[source.id], owner: 'gix-studio' }));
}
`;
    return Promise.resolve([{ path: `${GENERATED_ROOT}/context/application-context.ts`, content, itemIds: selected.map((item) => item.id) }]);
  },
  validate: (items) =>
    selectedOnly(items.context)
      .filter((item) => (item.kind === 'user' || item.kind === 'permissions') && item.sensitivity === 'public')
      .map((item) => ({ code: 'CONTEXT_SENSITIVITY', message: `${item.name} describes a user; "public" sensitivity is unusual.`, itemId: item.id })),
};

// --- Components → Generative UI (§38) -----------------------------------------------------

export const generativeUiGenerator: Generator<readonly GenerativeUIProposal[]> = {
  id: 'components-ui',
  title: 'Components → Generative UI',
  description: 'Proposes trusted, schema-validated components for @gixcopilot/generative-ui.',
  analyze(context, input) {
    const candidates = pick(
      context.discovery.components.filter((component) => component.candidate),
      input.select,
      (component) => component.name,
    );
    return Promise.resolve(
      candidates.map((component) => ({
        id: `ui:${component.framework}:${component.name}`,
        selected: true,
        name: component.name.replace(/Component$/, ''),
        description: `Renders ${component.name} (${component.file}).`,
        framework: component.framework,
        file: component.file,
        props: component.props,
      })),
    );
  },
  generate(ui) {
    const warnings: ProposalWarning[] = ui.flatMap((item) =>
      item.props.filter((prop) => !zodFromTypeText(prop.type).known).map((prop) => ({ code: 'PROP_SCHEMA_UNKNOWN', message: `${item.name}.${prop.name} (${prop.type}) became z.unknown(); give it a precise schema.`, itemId: item.id })),
    );
    return Promise.resolve({ ...EMPTY_DRAFT, title: `Components → Generative UI: ${String(ui.length)} candidate(s)`, warnings, ui });
  },
  render(items) {
    const selected = selectedOnly(items.ui);
    if (selected.length === 0) return Promise.resolve([]);
    const definitions = selected.map((item) => {
      const fields = item.props.map((prop) => `${/^[A-Za-z_$][\w$]*$/.test(prop.name) ? prop.name : str(prop.name)}: ${zodFromTypeText(prop.type).code}${prop.optional ? '.optional()' : ''}`);
      return `/** Trusted renderer: ${item.file}. Register the component itself in your ${item.framework} adapter. */
export const ${identifier(item.name)}Component: AnyGenerativeComponentDefinition = {
  name: ${str(item.name)},
  description: ${str(item.description)},
  propsSchema: z.object({ ${fields.join(', ')} }),
  metadata: { custom: { generatedBy: 'gix-studio', framework: ${str(item.framework)}, source: ${str(item.file)} } },
};`;
    });
    const content = `${header('Components → Generative UI', 'The model may request these components by name with validated props; it never sends code.')}import type { AnyGenerativeComponentDefinition } from '@gixcopilot/generative-ui';
import { z } from 'zod';

${definitions.join('\n\n')}

export const generativeComponents: readonly AnyGenerativeComponentDefinition[] = [${selected.map((item) => `${identifier(item.name)}Component`).join(', ')}];
`;
    return Promise.resolve([{ path: `${GENERATED_ROOT}/ui/generative-components.ts`, content, itemIds: selected.map((item) => item.id) }]);
  },
  validate: () => [],
};

// --- Auth → Security Policies (§39) -------------------------------------------------------

interface SecurityAnalysis {
  readonly permissions: readonly string[];
  readonly policies: readonly PolicyProposal[];
}

const PERMISSION_CATALOG_FILE = `${GENERATED_ROOT}/security/permissions.ts`;

export const securityPolicyGenerator: Generator<SecurityAnalysis> = {
  id: 'auth-security',
  title: 'Auth → Security Policies',
  description: 'Turns discovered permissions and route guards into tool policy candidates for the Action Firewall.',
  analyze(context, input) {
    const permissions = [...new Set(context.discovery.permissions.map((permission) => permission.name))].sort();
    const operations = context.discovery.apis.flatMap((source) => source.operations).filter((operation) => operation.sourceKind !== 'frontend-client' && operation.permissions.length > 0);
    // One policy per tool name: an OpenAPI operation and its backend route describe the same
    // tool, so their permissions are merged rather than emitted twice.
    const byTool = new Map<string, PolicyProposal>();
    for (const operation of pick(operations, input.select, (candidate) => candidate.id)) {
      const tool = toolNameFor(operation.method, operation.path);
      const risk = suggestRisk(operation.method);
      const existing = byTool.get(tool);
      byTool.set(tool, {
        id: existing?.id ?? `policy:${tool}`,
        selected: true,
        tool,
        requiredPermissions: [...new Set([...(existing?.requiredPermissions ?? []), ...operation.permissions])],
        approval: approvalFloor(risk),
        risk,
      });
    }
    return Promise.resolve({ permissions, policies: [...byTool.values()] });
  },
  generate(analysis) {
    const catalog: ConfigChange = { id: 'config:permission-catalog', selected: analysis.permissions.length > 0, file: PERMISSION_CATALOG_FILE, key: 'discoveredPermissions', after: analysis.permissions };
    const warnings: ProposalWarning[] = analysis.permissions.length === 0 ? [{ code: 'NO_PERMISSIONS', message: 'No permission definitions were discovered; nothing to map.' }] : [];
    return Promise.resolve({ ...EMPTY_DRAFT, title: `Auth → Security: ${String(analysis.permissions.length)} permission(s), ${String(analysis.policies.length)} policy candidate(s)`, warnings, policies: analysis.policies, configChanges: [catalog] });
  },
  render(items: ProposalItems) {
    const files: RenderedFile[] = [];
    const catalog = items.configChanges.find((change) => change.id === 'config:permission-catalog' && change.selected);
    if (catalog && Array.isArray(catalog.after)) {
      const names = (catalog.after as unknown[]).filter((value): value is string => typeof value === 'string');
      files.push({
        path: PERMISSION_CATALOG_FILE,
        content: `${header('Auth → Security Policies', 'Permission candidates found in the code. Verify each one.')}import type { RolePermissionMap } from '@gixcopilot/security';

export const discoveredPermissions = [${names.map(str).join(', ')}] as const;

export type DiscoveredPermission = (typeof discoveredPermissions)[number];

/** Map your roles to permissions. Deliberately empty: GIX never guesses who may do what. */
export const rolePermissions: RolePermissionMap = {};
`,
        itemIds: [catalog.id],
      });
    }
    const policies = selectedOnly(items.policies);
    if (policies.length > 0) {
      const entries = policies.map((policy) => `  ${str(policy.tool)}: { risk: ${str(policy.risk)}, approval: ${str(policy.approval)}, requiredPermissions: [${policy.requiredPermissions.map(str).join(', ')}] },`);
      files.push({
        path: `${GENERATED_ROOT}/security/route-policies.ts`,
        content: `${header('Auth → Security Policies', 'Spread an entry into a tool\'s `security` option; the Action Firewall enforces it.')}import type { ToolSecurityManifest } from '@gixcopilot/protocol';

export const routeToolSecurity = {
${entries.join('\n')}
} as const satisfies Readonly<Record<string, ToolSecurityManifest>>;
`,
        itemIds: policies.map((policy) => policy.id),
      });
    }
    return Promise.resolve(files);
  },
  validate: () => [],
};

