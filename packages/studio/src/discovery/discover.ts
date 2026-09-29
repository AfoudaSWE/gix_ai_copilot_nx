import { createOpenAPILoader, discoverOperations, resolveLocalRefs, validateOpenAPIDocument } from '@gixcopilot/openapi';
import type { OpenAPIDocument, OpenAPIOperationCandidate } from '@gixcopilot/openapi';
import type { ReadonlyWorkspace } from '../workspace/workspace.js';
import { loadTypeScript } from './ast.js';
import { BACKEND_FRAMEWORKS, DEFAULT_DETECTORS, FRONTEND_FRAMEWORKS, runDetectors } from './detectors.js';
import type { PackageManifest, ProjectDetector } from './detectors.js';
import type {
  ApiOperation,
  ApiSource,
  ApplicationInfo,
  AuthenticationInfo,
  ComponentInfo,
  ContextCandidate,
  DetectedCommands,
  DiscoveredProject,
  DiscoveryDiagnostic,
  FrameworkId,
  KnowledgeCandidate,
  LibraryInfo,
  PackageManagerName,
  PermissionInfo,
  RouteInfo,
} from './model.js';
import { analyzeSource, analyzeVueComponent } from './source-analyzer.js';
import type { ApiCallFinding } from './source-analyzer.js';

export interface DiscoverProjectOptions {
  readonly signal?: AbortSignal;
  /** Replace or extend the framework detectors (§14). */
  readonly detectors?: readonly ProjectDetector[];
  /** Most knowledge candidates reported (default 500). */
  readonly maxKnowledgeSources?: number;
}

const CODE_FILE = /\.(tsx?|jsx?|mjs|cjs|vue)$/;
const DECLARATION_OR_TEST = /(\.d\.ts|\.(spec|test|e2e|stories)\.[cm]?[jt]sx?)$/;
const TEST_FILE = /\.(spec|test)\.[cm]?[jt]sx?$/;
const SPEC_FILE = /\.(json|ya?ml)$/;
const SPEC_NAME = /openapi|swagger|api-?spec|api-?docs/i;
const NON_SPEC_NAME = /^(package|package-lock|tsconfig.*|project|nx|angular|pnpm-lock|pnpm-workspace|composer|\.eslintrc.*|\.prettierrc.*|turbo|lerna|vercel|renovate)\.(json|ya?ml)$/i;

const AUTH_LIBRARIES: Readonly<Record<string, string>> = {
  passport: 'session or strategy-based (Passport)',
  'passport-jwt': 'JWT',
  jsonwebtoken: 'JWT',
  jose: 'JWT',
  '@fastify/jwt': 'JWT',
  '@fastify/auth': 'custom',
  '@fastify/session': 'session',
  'express-session': 'session',
  '@nestjs/passport': 'session or strategy-based (Passport)',
  '@nestjs/jwt': 'JWT',
  'next-auth': 'OAuth/OIDC (Auth.js)',
  '@auth/core': 'OAuth/OIDC (Auth.js)',
  '@auth0/auth0-react': 'OAuth/OIDC (Auth0)',
  '@auth0/auth0-angular': 'OAuth/OIDC (Auth0)',
  '@auth0/nextjs-auth0': 'OAuth/OIDC (Auth0)',
  '@azure/msal-browser': 'OAuth/OIDC (Microsoft Entra)',
  '@azure/msal-angular': 'OAuth/OIDC (Microsoft Entra)',
  '@azure/msal-react': 'OAuth/OIDC (Microsoft Entra)',
  'keycloak-js': 'OAuth/OIDC (Keycloak)',
  'oidc-client-ts': 'OAuth/OIDC',
  'angular-oauth2-oidc': 'OAuth/OIDC',
  firebase: 'Firebase Authentication',
  '@supabase/supabase-js': 'Supabase Auth',
  '@clerk/clerk-react': 'Clerk',
  '@clerk/nextjs': 'Clerk',
};

const TOKEN_HANDLING: readonly [RegExp, string][] = [
  [/localStorage\.(get|set)Item\(\s*['"`][^'"`]*(token|jwt|auth)/i, 'Token kept in localStorage'],
  [/sessionStorage\.(get|set)Item\(\s*['"`][^'"`]*(token|jwt|auth)/i, 'Token kept in sessionStorage'],
  [/Authorization['"]?\s*[:,=]\s*[`'"]Bearer/, 'Bearer token sent in the Authorization header'],
  [/implements\s+HttpInterceptor/, 'Angular HttpInterceptor adds credentials'],
  [/withCredentials\s*:\s*true|credentials\s*:\s*['"]include['"]/, 'Cookie credentials sent with requests'],
  [/document\.cookie/, 'Reads document.cookie'],
];

const TEST_LIBRARIES = ['vitest', 'jest', 'mocha', '@playwright/test', 'cypress', 'karma', 'jasmine-core', '@testing-library/react', '@testing-library/angular', '@testing-library/vue'];
const BUILD_LIBRARIES = ['vite', 'webpack', 'esbuild', 'tsup', 'rollup', '@angular/cli', '@angular/build', 'next', 'nx', 'turbo', 'parcel', 'typescript'];

function parseManifest(path: string, text: string): PackageManifest | undefined {
  try {
    const json = JSON.parse(text) as Record<string, unknown>;
    const record = (value: unknown): Record<string, string> => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, string>) : {});
    const workspaces = Array.isArray(json['workspaces']) ? (json['workspaces'] as string[]) : Array.isArray(record(json['workspaces'])['packages']) ? (record(json['workspaces'])['packages'] as unknown as string[]) : undefined;
    return {
      path,
      directory: path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '',
      name: typeof json['name'] === 'string' ? json['name'] : undefined,
      private: json['private'] === true,
      dependencies: { ...record(json['peerDependencies']), ...record(json['devDependencies']), ...record(json['dependencies']) },
      scripts: record(json['scripts']),
      ...(workspaces ? { workspaces } : {}),
    };
  } catch {
    return undefined;
  }
}

function packageManagerOf(files: ReadonlySet<string>, rootManifest: PackageManifest | undefined, packageManagerField: string | undefined): PackageManagerName {
  if (files.has('pnpm-lock.yaml')) return 'pnpm';
  if (files.has('yarn.lock')) return 'yarn';
  if (files.has('bun.lockb') || files.has('bun.lock')) return 'bun';
  if (files.has('package-lock.json')) return 'npm';
  const declared = packageManagerField?.split('@')[0];
  if (declared === 'pnpm' || declared === 'yarn' || declared === 'bun' || declared === 'npm') return declared;
  return rootManifest ? 'npm' : 'npm';
}

function detectCommands(manager: PackageManagerName, scripts: Readonly<Record<string, string>>): DetectedCommands {
  const pick = (...names: string[]): { command: string; args: string[] } | undefined => {
    const name = names.find((candidate) => scripts[candidate] !== undefined);
    return name ? { command: manager, args: ['run', name] } : undefined;
  };
  const typecheck = pick('typecheck', 'type-check', 'check-types', 'tsc');
  const lint = pick('lint');
  const test = pick('test');
  const build = pick('build');
  return { ...(typecheck ? { typecheck } : {}), ...(lint ? { lint } : {}), ...(test ? { test } : {}), ...(build ? { build } : {}) };
}

function toOperationId(finding: ApiCallFinding, file: string): string {
  return `${finding.method} ${finding.path} @ ${file}:${String(finding.line)}`;
}

function sourceNameOf(file: string): string {
  const base = file.split('/').pop() ?? file;
  return base.replace(/\.(controller|routes?|service|api|client)?\.?[cm]?[jt]sx?$/, '').replace(/\.$/, '') || base;
}

function openApiOperation(file: string, title: string | undefined, document: Record<string, unknown>, candidate: OpenAPIOperationCandidate): ApiOperation {
  const paths = (document['paths'] ?? {}) as Record<string, Record<string, Record<string, unknown>>>;
  const raw = paths[candidate.path]?.[candidate.method] ?? {};
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const parameter of candidate.parameters) {
    if (parameter.in !== 'path' && parameter.in !== 'query') continue;
    properties[parameter.name] = parameter.schema;
    if (parameter.required) required.push(parameter.name);
  }
  if (candidate.requestBodySchema) {
    properties['body'] = candidate.requestBodySchema;
    if (candidate.requestBodyRequired) required.push('body');
  }
  const responses = candidate.responseSchemas ?? {};
  const success = Object.keys(responses).find((status) => /^2\d\d$/.test(status));
  const security = (raw['security'] ?? document['security']) as unknown[] | undefined;
  const extension = raw['x-permissions'] ?? raw['x-required-permissions'];
  return {
    id: `${candidate.method.toUpperCase()} ${candidate.path} @ ${file}`,
    method: candidate.method.toUpperCase() as ApiOperation['method'],
    path: candidate.path,
    ...(candidate.operationId ? { operationId: candidate.operationId } : {}),
    ...(candidate.summary ? { summary: candidate.summary } : {}),
    input: { type: 'object', properties, ...(required.length > 0 ? { required } : {}) },
    ...(success ? { output: responses[success] as Record<string, unknown> } : {}),
    ...(Array.isArray(security) && security.length > 0 ? { authentication: security.flatMap((entry) => Object.keys(entry as Record<string, unknown>)).join(', ') || 'declared' } : {}),
    permissions: Array.isArray(extension) ? extension.filter((value): value is string => typeof value === 'string') : [],
    source: title ?? sourceNameOf(file),
    sourceKind: 'openapi',
    file,
  };
}

/**
 * Read-only project discovery (§12-24). Walks the workspace through the `ReadonlyWorkspace`
 * (which cannot write), respects ignore rules and secret exclusions, is bounded and
 * cancellable, and returns one normalized `DiscoveredProject`.
 */
export async function discoverProject(workspace: ReadonlyWorkspace, options: DiscoverProjectOptions = {}): Promise<DiscoveredProject> {
  const { signal } = options;
  const diagnostics: DiscoveryDiagnostic[] = [];
  const listing = await workspace.listFiles({ signal });
  const files = listing.files.map((file) => file.path);
  const fileSet = new Set(files);
  if (listing.truncated) diagnostics.push({ severity: 'warning', code: 'FILE_LIMIT', message: `Stopped after ${String(workspace.limits.maxFiles)} files; results are partial.` });
  if (listing.skippedSecrets > 0) diagnostics.push({ severity: 'info', code: 'SECRETS_SKIPPED', message: `${String(listing.skippedSecrets)} secret file(s) were excluded and never read.` });

  // --- Manifests and units ----------------------------------------------------------------
  const manifests: PackageManifest[] = [];
  let packageManagerField: string | undefined;
  for (const path of files.filter((file) => file === 'package.json' || file.endsWith('/package.json'))) {
    const text = await workspace.readText(path);
    const manifest = text ? parseManifest(path, text) : undefined;
    if (manifest) manifests.push(manifest);
    if (path === 'package.json' && text) packageManagerField = (JSON.parse(text) as { packageManager?: string }).packageManager;
  }
  const rootManifest = manifests.find((manifest) => manifest.path === 'package.json');
  if (!rootManifest) diagnostics.push({ severity: 'error', code: 'NO_PACKAGE_JSON', message: 'No package.json at the workspace root.' });
  const packageManager = packageManagerOf(fileSet, rootManifest, packageManagerField);

  const nxProjects: { name: string; path: string; type: 'application' | 'library' }[] = [];
  for (const path of files.filter((file) => file.endsWith('project.json'))) {
    const text = await workspace.readText(path);
    try {
      const json = text ? (JSON.parse(text) as { name?: string; projectType?: string }) : undefined;
      if (!json) continue;
      const directory = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
      nxProjects.push({ name: json.name ?? directory, path: directory, type: json.projectType === 'application' ? 'application' : 'library' });
    } catch {
      diagnostics.push({ severity: 'warning', code: 'INVALID_PROJECT_JSON', message: 'project.json could not be parsed.', file: path });
    }
  }
  const isNx = fileSet.has('nx.json');
  const workspaceKind: DiscoveredProject['workspace']['kind'] = isNx ? 'nx' : fileSet.has('pnpm-workspace.yaml') ? 'pnpm-workspaces' : rootManifest?.workspaces ? 'npm-workspaces' : 'single';

  const unitDirectories: { name: string; path: string; type?: 'application' | 'library' }[] =
    isNx && nxProjects.length > 0
      ? nxProjects
      : workspaceKind === 'single'
        ? [{ name: rootManifest?.name ?? 'workspace', path: '' }]
        : manifests.filter((manifest) => manifest.directory !== '').map((manifest) => ({ name: manifest.name ?? manifest.directory, path: manifest.directory }));

  const within = (directory: string, file: string): boolean => directory === '' || file === directory || file.startsWith(`${directory}/`);
  const unitOf = (file: string): (typeof unitDirectories)[number] | undefined =>
    unitDirectories.filter((unit) => within(unit.path, file)).sort((a, b) => b.path.length - a.path.length)[0];

  const detectors = options.detectors ?? DEFAULT_DETECTORS;
  const applications: ApplicationInfo[] = [];
  const libraries: LibraryInfo[] = [];
  const unitFrameworks = new Map<string, readonly FrameworkId[]>();
  for (const unit of unitDirectories) {
    const unitManifests = manifests.filter((manifest) => manifest.directory === unit.path);
    const scope = unitManifests.length > 0 ? unitManifests : rootManifest ? [rootManifest] : [];
    const unitFiles = files.filter((file) => within(unit.path, file) && !file.slice(unit.path.length + 1).includes('/'));
    const frameworks = runDetectors(detectors, { manifests: scope, files: unitFiles }).map((framework) => framework.id).filter((id) => id !== 'typescript' && id !== 'nx');
    unitFrameworks.set(unit.path, frameworks);
    const scripts = scope[0]?.scripts ?? {};
    const runnable = scripts['dev'] !== undefined || scripts['start'] !== undefined || scripts['serve'] !== undefined || fileSet.has(unit.path ? `${unit.path}/index.html` : 'index.html');
    const type = unit.type ?? (runnable && frameworks.some((id) => FRONTEND_FRAMEWORKS.has(id) || BACKEND_FRAMEWORKS.has(id)) ? 'application' : workspaceKind === 'single' ? 'application' : 'library');
    (type === 'application' ? applications : libraries).push({ name: unit.name, path: unit.path || '.', frameworks });
  }

  const frameworks = runDetectors(detectors, { manifests, files: files.filter((file) => !file.includes('/') || /(^|\/)(nx|angular|nest-cli)\.json$|\/?(vite|next)\.config\./.test(file)) });
  const typescript = frameworks.some((framework) => framework.id === 'typescript') || files.some((file) => /\.tsx?$/.test(file));
  if (!typescript) frameworks.push({ id: 'javascript', role: 'language', evidence: ['no TypeScript configuration found'] });

  const isFrontendFile = (file: string): boolean => {
    if (file.endsWith('.vue') || file.endsWith('.tsx') || file.endsWith('.jsx')) return true;
    const unit = unitOf(file);
    const ids = unit ? (unitFrameworks.get(unit.path) ?? []) : [];
    return ids.some((id) => FRONTEND_FRAMEWORKS.has(id)) && !ids.some((id) => BACKEND_FRAMEWORKS.has(id));
  };

  // --- Source analysis ------------------------------------------------------------------
  const ts = await loadTypeScript();
  const codeFiles = files.filter((file) => CODE_FILE.test(file) && !DECLARATION_OR_TEST.test(file) && !file.startsWith('.gix/'));
  const apis: ApiSource[] = [];
  const routes: RouteInfo[] = [];
  const components: ComponentInfo[] = [];
  const contextByName = new Map<string, ContextCandidate>();
  const permissionsByName = new Map<string, PermissionInfo>();
  const userModels: { name: string; file: string }[] = [];
  const tokenHandling = new Set<string>();
  let tooLarge = 0;
  if (!ts) {
    diagnostics.push({ severity: 'warning', code: 'AST_UNAVAILABLE', message: 'The "typescript" package is not installed, so API, component, context and permission discovery could not parse source files. Install typescript as a devDependency and re-scan.' });
  }
  for (const file of codeFiles) {
    signal?.throwIfAborted();
    const text = await workspace.readText(file);
    if (text === undefined) {
      tooLarge += 1;
      continue;
    }
    for (const [pattern, fact] of TOKEN_HANDLING) if (pattern.test(text)) tokenHandling.add(fact);
    if (!ts) continue;
    try {
      if (file.endsWith('.vue')) {
        components.push(analyzeVueComponent(ts, file, text));
        continue;
      }
      const findings = analyzeSource(ts, file, text, isFrontendFile(file));
      routes.push(...findings.routes);
      components.push(...findings.components);
      for (const candidate of findings.contextCandidates) if (!contextByName.has(candidate.name)) contextByName.set(candidate.name, candidate);
      for (const permission of findings.permissions) if (!permissionsByName.has(permission.name)) permissionsByName.set(permission.name, permission);
      for (const name of findings.userModels) userModels.push({ name, file });
      for (const kind of ['backend-route', 'frontend-client'] as const) {
        const calls = findings.apiCalls.filter((call) => call.kind === kind);
        if (calls.length === 0) continue;
        apis.push({
          id: `${kind}:${file}`,
          kind,
          file,
          operations: calls.map((call) => ({
            id: toOperationId(call, file),
            method: call.method,
            path: call.path,
            ...(call.handler ? { operationId: call.handler } : {}),
            ...(call.authenticated ? { authentication: 'required' } : {}),
            permissions: call.permissions,
            source: sourceNameOf(file),
            sourceKind: kind,
            file,
            line: call.line,
          })),
        });
        for (const call of calls) {
          for (const name of call.permissions) if (!permissionsByName.has(name)) permissionsByName.set(name, { name, file, line: call.line });
        }
      }
    } catch (error) {
      diagnostics.push({ severity: 'warning', code: 'PARSE_FAILED', message: `Could not analyze file: ${error instanceof Error ? error.message : String(error)}`, file });
    }
  }
  if (tooLarge > 0) diagnostics.push({ severity: 'info', code: 'FILES_TOO_LARGE', message: `${String(tooLarge)} source file(s) exceeded ${String(workspace.limits.maxFileBytes)} bytes and were skipped.` });

  // --- OpenAPI documents -----------------------------------------------------------------
  const loader = createOpenAPILoader();
  const specFiles: string[] = [];
  for (const file of files.filter((path) => SPEC_FILE.test(path) && !NON_SPEC_NAME.test(path.split('/').pop() ?? ''))) {
    signal?.throwIfAborted();
    const named = SPEC_NAME.test(file);
    const text = await workspace.readText(file);
    if (!text) continue;
    const head = text.slice(0, 4000);
    if (!named && !/["']?(openapi|swagger)["']?\s*:/.test(head)) continue;
    if (/["']?swagger["']?\s*:\s*["']?2/.test(head)) {
      diagnostics.push({ severity: 'warning', code: 'SWAGGER_2_UNSUPPORTED', message: 'Swagger 2.0 documents are not supported; convert to OpenAPI 3.x to discover its operations.', file });
      continue;
    }
    if (!/["']?openapi["']?\s*:\s*["']?3/.test(head)) continue;
    try {
      const raw = await loader.load({ kind: 'file', path: workspace.guard.resolve(file) });
      const validation = validateOpenAPIDocument(raw);
      if (!validation.ok) {
        diagnostics.push({ severity: 'warning', code: 'OPENAPI_INVALID', message: `OpenAPI document has ${String(validation.issues.length)} issue(s).`, file });
        continue;
      }
      const document = resolveLocalRefs(raw) as Record<string, unknown>;
      const title = (document['info'] as { title?: string } | undefined)?.title;
      const operations = discoverOperations(document as unknown as OpenAPIDocument).map((candidate) => openApiOperation(file, title, document, candidate));
      apis.push({ id: `openapi:${file}`, kind: 'openapi', file, ...(title ? { title } : {}), operations });
      specFiles.push(file);
    } catch (error) {
      diagnostics.push({ severity: 'warning', code: 'OPENAPI_LOAD_FAILED', message: error instanceof Error ? error.message : 'Could not load the OpenAPI document.', file });
    }
  }

  // --- Authentication (§21): facts only, never secret values -----------------------------
  const allDependencies = Object.assign({}, ...manifests.map((manifest) => manifest.dependencies)) as Record<string, string>;
  const authLibraries = Object.keys(AUTH_LIBRARIES).filter((name) => allDependencies[name] !== undefined);
  const authFiles = codeFiles.filter((file) => /(^|[/._-])(auth|authentication|login|session|guards?|interceptors?|jwt|permissions?)([/._-]|$)/i.test(file)).slice(0, 50);
  const authentication: AuthenticationInfo | undefined =
    authLibraries.length > 0 || authFiles.length > 0 || tokenHandling.size > 0 || userModels.length > 0
      ? {
          mechanisms: [...new Set(authLibraries.map((name) => AUTH_LIBRARIES[name] ?? name))],
          libraries: authLibraries,
          files: authFiles,
          tokenHandling: [...tokenHandling],
          ...(userModels[0] ? { userModel: userModels[0] } : {}),
        }
      : undefined;

  // --- Knowledge (§23): candidates only, nothing indexed ----------------------------------
  const knowledgeSources: KnowledgeCandidate[] = [];
  const maxKnowledge = options.maxKnowledgeSources ?? 500;
  const sizeOf = new Map(listing.files.map((file) => [file.path, file.size]));
  for (const file of files) {
    const base = file.split('/').pop() ?? file;
    const inDocs = /(^|\/)docs?\//i.test(file);
    let kind: KnowledgeCandidate['kind'] | undefined;
    if (/^readme(\.[a-z]+)?$/i.test(base)) kind = 'readme';
    else if (specFiles.includes(file)) kind = 'openapi';
    else if (/\.mdx$/i.test(base) && (inDocs || !file.includes('/'))) kind = 'mdx';
    else if (/\.md$/i.test(base) && (inDocs || !file.includes('/'))) kind = 'markdown';
    else if (inDocs && /\.pdf$/i.test(base)) kind = 'pdf';
    else if (inDocs && /\.docx$/i.test(base)) kind = 'docx';
    else if (inDocs && /\.txt$/i.test(base)) kind = 'text';
    if (!kind || file.startsWith('.gix/') || file.startsWith('.claude/')) continue;
    if (knowledgeSources.length >= maxKnowledge) {
      diagnostics.push({ severity: 'info', code: 'KNOWLEDGE_LIMIT', message: `Only the first ${String(maxKnowledge)} knowledge candidates are listed.` });
      break;
    }
    let title: string | undefined;
    if (kind === 'readme' || kind === 'markdown' || kind === 'mdx') {
      const text = await workspace.readText(file);
      title = text ? /^#\s+(.+)$/m.exec(text)?.[1]?.trim() : undefined;
    }
    knowledgeSources.push({ path: file, kind, size: sizeOf.get(file) ?? 0, ...(title ? { title } : {}) });
  }

  // --- GIX integration, tests, tooling, commands -----------------------------------------
  const gixPackages = Object.keys(allDependencies).filter((name) => name.startsWith('@gixcopilot/') || name === 'gixcopilot').sort();
  const configFiles = files.filter((file) => /(^|\/)(aicopilot\.config\.json|gixcopilot\.config\.[cm]?[jt]s(on)?)$/.test(file) || file === '.gix/copilot.config.json');
  const generatedFiles = files.filter((file) => file.startsWith('.gix/'));
  const testFiles = files.filter((file) => TEST_FILE.test(file)).length;

  return {
    discoveredAt: new Date().toISOString(),
    workspace: {
      name: rootManifest?.name ?? workspace.root.split(/[\\/]/).pop() ?? 'workspace',
      root: workspace.root,
      packageManager,
      kind: workspaceKind,
      language: typescript ? 'typescript' : 'javascript',
      filesScanned: files.length,
      truncated: listing.truncated,
    },
    frameworks,
    applications,
    libraries,
    apis,
    routes,
    components,
    contextCandidates: [...contextByName.values()],
    ...(authentication ? { authentication } : {}),
    permissions: [...permissionsByName.values()],
    knowledgeSources,
    gix: { packages: gixPackages, configFiles, generatedFiles },
    tests: { frameworks: TEST_LIBRARIES.filter((name) => allDependencies[name] !== undefined), files: testFiles },
    buildTooling: BUILD_LIBRARIES.filter((name) => allDependencies[name] !== undefined || (name === 'nx' && isNx)),
    commands: detectCommands(packageManager, rootManifest?.scripts ?? {}),
    diagnostics,
  };
}
