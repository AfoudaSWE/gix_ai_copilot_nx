/**
 * The two planes (ADR 0023). The development plane helps a developer integrate GIX. It runs
 * only inside the Studio, in development. The application plane is what the application's
 * users talk to. The two planes share the core runtime but never authority: a development
 * capability is never an application tool, agent or skill unless separately designed and
 * explicitly authorized.
 */
export type Plane = 'development' | 'application';

export type CapabilityKind = 'tool' | 'agent' | 'skill';

export interface CapabilityDescriptor {
  readonly id: string;
  readonly plane: Plane;
  readonly kind: CapabilityKind;
  readonly description: string;
}

const dev = (kind: CapabilityKind, id: string, description: string): CapabilityDescriptor => ({ id, plane: 'development', kind, description });

/** Internal Studio tools (§43). Plain functions inside this package, never `ToolDefinition`s. */
export const DEVELOPMENT_TOOLS: readonly CapabilityDescriptor[] = [
  dev('tool', 'repo.getInfo', 'Workspace root, package manager and size summary.'),
  dev('tool', 'repo.getTree', 'Bounded directory tree, ignore- and secret-aware.'),
  dev('tool', 'repo.listFiles', 'Bounded file list, ignore- and secret-aware.'),
  dev('tool', 'repo.readFile', 'Read one non-secret file inside the workspace.'),
  dev('tool', 'repo.search', 'Search non-secret files for a literal string.'),
  dev('tool', 'repo.findFile', 'Find files by name.'),
  dev('tool', 'project.detect', 'Detect workspace, frameworks and language.'),
  dev('tool', 'project.getInfo', 'The normalized project model.'),
  dev('tool', 'project.getApps', 'Applications and libraries.'),
  dev('tool', 'project.getDependencies', 'Declared dependencies.'),
  dev('tool', 'project.getRoutes', 'Discovered routes.'),
  dev('tool', 'api.discover', 'Discover API operations.'),
  dev('tool', 'api.listOperations', 'List discovered API operations.'),
  dev('tool', 'api.inspectOperation', 'Inspect one discovered operation.'),
  dev('tool', 'ui.discoverComponents', 'Discover generative-UI component candidates.'),
  dev('tool', 'context.discover', 'Discover application context candidates.'),
  dev('tool', 'auth.discover', 'Analyze authentication without reading secrets.'),
  dev('tool', 'permission.discover', 'Discover permission definitions.'),
  dev('tool', 'config.inspect', 'Resolved configuration with secrets redacted.'),
  dev('tool', 'diagnostics.get', 'Integration health.'),
];

/** Internal development agents (§44). */
export const DEVELOPMENT_AGENTS: readonly CapabilityDescriptor[] = [
  dev('agent', 'project-discovery', 'Understands the repository layout.'),
  dev('agent', 'repo-explorer', 'Navigates files for other development agents.'),
  dev('agent', 'api-explorer', 'Finds and explains API operations.'),
  dev('agent', 'tool-builder', 'Proposes application tools from APIs.'),
  dev('agent', 'context-analyzer', 'Proposes application context sources.'),
  dev('agent', 'ui-analyzer', 'Proposes trusted generative-UI components.'),
  dev('agent', 'security-analyzer', 'Reviews proposals against the Action Firewall rules.'),
];

/** Internal development skills (§45). */
export const DEVELOPMENT_SKILLS: readonly CapabilityDescriptor[] = [
  'repository-understanding',
  'project-discovery',
  'api-discovery',
  'api-analysis',
  'api-to-tool-generation',
  'openapi-to-tool-generation',
  'context-discovery',
  'generative-ui-discovery',
  'permission-analysis',
  'tool-security-review',
].map((id) => dev('skill', id, `Development skill: ${id}.`));

export const DEVELOPMENT_CAPABILITIES: readonly CapabilityDescriptor[] = [...DEVELOPMENT_TOOLS, ...DEVELOPMENT_AGENTS, ...DEVELOPMENT_SKILLS];

/**
 * Tool-name namespaces reserved for the development plane (§4). An application tool may not
 * use them, so `repo.readFile` or `shell.run` can never be registered as an end-user tool by
 * accident, including through a generated or imported tool name.
 */
export const RESERVED_DEVELOPMENT_NAMESPACES: readonly string[] = ['repo', 'shell', 'git', 'project', 'code', 'validate', 'studio', 'devtools'];

/** Exact development tool names outside a reserved namespace (e.g. `api.discover`). */
const RESERVED_DEVELOPMENT_NAMES: ReadonlySet<string> = new Set(DEVELOPMENT_TOOLS.map((tool) => tool.id));

export function isDevelopmentToolName(name: string): boolean {
  const namespace = name.split('.')[0] ?? '';
  return RESERVED_DEVELOPMENT_NAMES.has(name) || RESERVED_DEVELOPMENT_NAMESPACES.includes(namespace);
}

export class PlaneViolationError extends Error {
  readonly names: readonly string[];

  constructor(names: readonly string[]) {
    super(`Development-plane capabilities cannot be application tools: ${names.join(', ')}. See ADR 0023.`);
    this.name = 'PlaneViolationError';
    this.names = names;
  }
}

/** Anything that can list tool names: a `ToolRegistry`, a manifest, or a plain array. */
export type ToolNameSource = { list(): readonly { readonly name: string }[] } | readonly { readonly name: string }[];

/** Throws when an application tool set contains a development-plane capability (§4, §72). */
export function assertApplicationPlane(tools: ToolNameSource): void {
  const entries = Array.isArray(tools) ? (tools as readonly { readonly name: string }[]) : (tools as { list(): readonly { readonly name: string }[] }).list();
  const violations = entries.map((tool) => tool.name).filter(isDevelopmentToolName);
  if (violations.length > 0) throw new PlaneViolationError(violations);
}

/** A development agent or skill id. Application agents/skills may not reuse these ids. */
export function isDevelopmentAgentOrSkill(id: string): boolean {
  return DEVELOPMENT_AGENTS.some((agent) => agent.id === id) || DEVELOPMENT_SKILLS.some((skill) => skill.id === id);
}
