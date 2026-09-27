/** Dev-server proxy target and prefix shared by every framework integration. */
export const API_PREFIX = '/api/copilot';
export const SERVER_URL = 'http://127.0.0.1:4000';

export type PatchResult = { readonly changed: true; readonly content: string } | { readonly changed: false; readonly reason: string };

/**
 * Adds the `/api/copilot` dev proxy to a Vite config. Only the common shape
 * `defineConfig({ ... })` without an existing `server` key is edited; anything else is left
 * alone and the caller prints the snippet instead. Never rewrites user code it cannot see.
 */
export function patchViteConfig(source: string): PatchResult {
  if (source.includes(API_PREFIX)) return { changed: false, reason: 'already configured' };
  if (/\bserver\s*:/.test(source)) return { changed: false, reason: 'the config already has a "server" section' };
  const match = /defineConfig\(\s*\{/.exec(source);
  if (!match) return { changed: false, reason: 'no defineConfig({ ... }) call found' };
  const at = match.index + match[0].length;
  const proxy = `\n  // Added by @gixcopilot/create: the browser calls ${API_PREFIX}, the copilot server answers.\n  server: { proxy: { '${API_PREFIX}': { target: '${SERVER_URL}', rewrite: (path) => path.replace(/^\\/api\\/copilot/, '') } } },`;
  return { changed: true, content: source.slice(0, at) + proxy + source.slice(at) };
}

export const VITE_PROXY_SNIPPET = `server: { proxy: { '${API_PREFIX}': { target: '${SERVER_URL}', rewrite: (path) => path.replace(/^\\/api\\/copilot/, '') } } },`;

export const ANGULAR_PROXY_FILE = 'proxy.conf.json';

export const ANGULAR_PROXY = `${JSON.stringify({ [API_PREFIX]: { target: SERVER_URL, pathRewrite: { '^/api/copilot': '' }, secure: false } }, null, 2)}\n`;

interface AngularWorkspace {
  projects?: Record<string, { projectType?: string; architect?: Record<string, { options?: Record<string, unknown> }> }>;
}

/** Points `ng serve` of every application project at proxy.conf.json (unless one is set). */
export function patchAngularJson(source: string): PatchResult {
  let workspace: AngularWorkspace;
  try {
    workspace = JSON.parse(source) as AngularWorkspace;
  } catch {
    return { changed: false, reason: 'angular.json is not plain JSON' };
  }
  let changed = false;
  for (const project of Object.values(workspace.projects ?? {})) {
    if (project.projectType !== 'application') continue;
    const serve = project.architect?.['serve'];
    if (!serve) continue;
    serve.options ??= {};
    if (serve.options['proxyConfig']) continue;
    serve.options['proxyConfig'] = ANGULAR_PROXY_FILE;
    changed = true;
  }
  return changed
    ? { changed: true, content: `${JSON.stringify(workspace, null, 2)}\n` }
    : { changed: false, reason: 'no application "serve" target without a proxy' };
}

/** Adds scripts to package.json without replacing existing ones. */
export function patchScripts(source: string, scripts: Readonly<Record<string, string>>): PatchResult {
  const pkg = JSON.parse(source) as { scripts?: Record<string, string> };
  pkg.scripts ??= {};
  const added = Object.entries(scripts).filter(([name]) => pkg.scripts?.[name] === undefined);
  if (added.length === 0) return { changed: false, reason: 'scripts already present' };
  for (const [name, command] of added) pkg.scripts[name] = command;
  const indent = /^\{\r?\n(\s+)"/.exec(source)?.[1] ?? '  ';
  return { changed: true, content: `${JSON.stringify(pkg, null, indent)}\n` };
}
