/**
 * The normalized discovery model (§15). Every value comes from what discovery actually found
 * in the repository; nothing is estimated or filled in (§16 "do not fabricate counts").
 */

export type PackageManagerName = 'npm' | 'pnpm' | 'yarn' | 'bun';

export type FrameworkId =
  | 'nx'
  | 'react'
  | 'angular'
  | 'vue'
  | 'nextjs'
  | 'vite'
  | 'node'
  | 'fastify'
  | 'express'
  | 'nestjs'
  | 'typescript'
  | 'javascript';

export type FrameworkRole = 'workspace' | 'frontend' | 'backend' | 'build' | 'language';

export interface WorkspaceInfo {
  readonly name: string;
  readonly root: string;
  readonly packageManager: PackageManagerName;
  /** `nx`, `pnpm-workspaces`, `npm-workspaces` or `single`. */
  readonly kind: 'nx' | 'pnpm-workspaces' | 'npm-workspaces' | 'single';
  readonly language: 'typescript' | 'javascript';
  readonly filesScanned: number;
  readonly truncated: boolean;
}

export interface FrameworkInfo {
  readonly id: FrameworkId;
  readonly role: FrameworkRole;
  readonly version?: string;
  /** The file(s) that proved it: a dependency in a package.json, a config file, etc. */
  readonly evidence: readonly string[];
}

export interface ProjectUnit {
  readonly name: string;
  readonly path: string;
  readonly frameworks: readonly FrameworkId[];
}

export type ApplicationInfo = ProjectUnit;
export type LibraryInfo = ProjectUnit;

export type ApiSourceKind = 'openapi' | 'swagger' | 'postman' | 'backend-route' | 'frontend-client';

export interface ApiOperation {
  readonly id: string;
  readonly method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  readonly path: string;
  readonly operationId?: string;
  readonly summary?: string;
  /** JSON Schema of the input where the source declares one (OpenAPI), else path params only. */
  readonly input?: Readonly<Record<string, unknown>>;
  readonly output?: Readonly<Record<string, unknown>>;
  readonly authentication?: string;
  readonly permissions: readonly string[];
  readonly source: string;
  readonly sourceKind: ApiSourceKind;
  readonly file: string;
  readonly line?: number;
}

export interface ApiSource {
  readonly id: string;
  readonly kind: ApiSourceKind;
  readonly file: string;
  readonly title?: string;
  readonly operations: readonly ApiOperation[];
}

export interface RouteInfo {
  readonly path: string;
  readonly kind: 'frontend' | 'backend';
  readonly file: string;
  readonly line?: number;
  /** The page component the route renders, when the route definition names it. */
  readonly component?: string;
}

export type OperationConfidence = 'high' | 'medium' | 'review';

/**
 * One API operation after every source that describes it has been merged (§17, §21). Sources
 * are ranked (OpenAPI 3 > Swagger > backend routes > Postman > frontend calls); the strongest
 * one supplies the contract, and disagreements are listed as conflicts, never merged silently.
 */
export interface NormalizedApiOperation {
  /** Method + canonical path, e.g. `GET /applications/{}`. */
  readonly key: string;
  readonly method: ApiOperation['method'];
  /** The path as the strongest source writes it. */
  readonly path: string;
  readonly operationId?: string;
  readonly summary?: string;
  readonly input?: Readonly<Record<string, unknown>>;
  readonly output?: Readonly<Record<string, unknown>>;
  readonly authentication?: string;
  readonly permissions: readonly string[];
  readonly sources: readonly { readonly kind: ApiSourceKind; readonly file: string; readonly line?: number; readonly operationId?: string }[];
  /** The strongest source's operation, which generators use. */
  readonly primary: ApiOperation;
  readonly confidence: OperationConfidence;
  readonly conflicts: readonly string[];
}

/** A frontend route with what its page uses (§30). */
export interface PageInfo {
  readonly route: string;
  readonly params: readonly string[];
  readonly component?: string;
  readonly file?: string;
  /** Normalized operation keys the page (or files it imports) calls. */
  readonly operations: readonly string[];
  readonly contextCandidates: readonly string[];
  readonly entity?: string;
}

export interface ComponentProp {
  readonly name: string;
  readonly type: string;
  readonly optional: boolean;
}

export interface ComponentInfo {
  readonly name: string;
  readonly framework: 'react' | 'angular' | 'vue';
  readonly file: string;
  readonly line?: number;
  readonly props: readonly ComponentProp[];
  /** Why it looks like a good trusted generative-UI component, or why not. */
  readonly candidate: boolean;
  readonly reason: string;
}

export type ContextCandidateKind = 'user' | 'route' | 'entity' | 'tenant' | 'permissions' | 'state';

export interface ContextCandidate {
  readonly name: string;
  readonly kind: ContextCandidateKind;
  readonly file: string;
  readonly line?: number;
  readonly evidence: string;
}

export interface AuthenticationInfo {
  readonly mechanisms: readonly string[];
  readonly libraries: readonly string[];
  readonly files: readonly string[];
  /** e.g. "token read from localStorage" - facts, never the token itself. */
  readonly tokenHandling: readonly string[];
  readonly userModel?: { readonly name: string; readonly file: string };
}

export interface PermissionInfo {
  readonly name: string;
  readonly file: string;
  readonly line?: number;
  readonly value?: string;
}

export interface KnowledgeCandidate {
  readonly path: string;
  readonly kind: 'readme' | 'markdown' | 'mdx' | 'openapi' | 'pdf' | 'docx' | 'text';
  readonly size: number;
  readonly title?: string;
}

export type DiagnosticSeverity = 'info' | 'warning' | 'error';

export interface DiscoveryDiagnostic {
  readonly severity: DiagnosticSeverity;
  readonly code: string;
  readonly message: string;
  readonly file?: string;
}

export interface GixIntegrationInfo {
  readonly packages: readonly string[];
  readonly configFiles: readonly string[];
  readonly generatedFiles: readonly string[];
}

export interface DiscoveredProject {
  readonly discoveredAt: string;
  readonly workspace: WorkspaceInfo;
  readonly frameworks: readonly FrameworkInfo[];
  readonly applications: readonly ApplicationInfo[];
  readonly libraries: readonly LibraryInfo[];
  readonly apis: readonly ApiSource[];
  readonly routes: readonly RouteInfo[];
  readonly components: readonly ComponentInfo[];
  readonly operations: readonly NormalizedApiOperation[];
  readonly pages: readonly PageInfo[];
  readonly contextCandidates: readonly ContextCandidate[];
  readonly authentication?: AuthenticationInfo;
  readonly permissions: readonly PermissionInfo[];
  readonly knowledgeSources: readonly KnowledgeCandidate[];
  readonly gix: GixIntegrationInfo;
  readonly tests: { readonly frameworks: readonly string[]; readonly files: number };
  readonly buildTooling: readonly string[];
  /** Commands detected from package.json scripts, used by post-apply validation (§58). */
  readonly commands: DetectedCommands;
  readonly diagnostics: readonly DiscoveryDiagnostic[];
}

export interface DetectedCommand {
  readonly command: string;
  readonly args: readonly string[];
}

export interface DetectedCommands {
  readonly typecheck?: DetectedCommand;
  readonly lint?: DetectedCommand;
  readonly test?: DetectedCommand;
  readonly build?: DetectedCommand;
}

export function countOperations(project: Pick<DiscoveredProject, 'apis'>): number {
  return project.apis.reduce((total, source) => total + source.operations.length, 0);
}
