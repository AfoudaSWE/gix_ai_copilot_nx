import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { connect } from 'node:net';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { ConfigError, describeConfig, loadConfig } from '@gixcopilot/config';
import { createEvalRunner, evaluateGates, renderEvalReport, toEvalJson } from '@gixcopilot/evals';
import type { EvalDataset, EvalRun, EvalTarget, Evaluator, GateThresholds } from '@gixcopilot/evals';
import { discoverOperations, inspectOpenAPI, operationKey, resolveLocalRefs } from '@gixcopilot/openapi';
import { appendExport, readJson, writePlan } from './files.js';
import type { PlannedFile } from './files.js';
import { fileSlug, identifierFromSlug, packageName, toolNameFromSlug } from './names.js';
import { agentFile, agentSpec, templateFiles, TEMPLATES, toolFile, toolSpec } from './templates.js';
import type { Template } from './templates.js';

export interface CliIo {
  readonly cwd: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  out(line: string): void;
  err(line: string): void;
}

export type Flags = Readonly<Record<string, string | boolean | undefined>>;

const str = (flags: Flags, key: string): string | undefined => (typeof flags[key] === 'string' ? flags[key] : undefined);

function reportWrite(io: CliIo, result: { written: readonly string[]; conflicts: readonly string[] }): number {
  if (result.written.length === 0 && result.conflicts.length > 0) {
    io.err('These files already exist; nothing was written (use --force to overwrite):');
    for (const conflict of result.conflicts) io.err(`  ${conflict}`);
    return 1;
  }
  for (const file of result.written) io.out(`  created ${file}`);
  return 0;
}

/* ------------------------------------------------------------------------------ init */

export async function init(io: CliIo, args: readonly string[], flags: Flags): Promise<number> {
  const directory = resolve(io.cwd, args[0] ?? '.');
  const template = (str(flags, 'template') ?? 'node') as Template;
  if (!TEMPLATES.includes(template)) {
    io.err(`Unknown template "${template}". Choose one of: ${TEMPLATES.join(', ')}.`);
    return 2;
  }
  const name = packageName(str(flags, 'name') ?? basename(directory));
  const sdkPath = str(flags, 'sdk-path');
  let sdkTarballs: Record<string, string> | undefined;
  if (sdkPath) {
    sdkTarballs = {};
    for (const file of await readdir(resolve(io.cwd, sdkPath))) {
      const match = /^gixcopilot-(.+)-\d+\.\d+\.\d+.*\.tgz$/.exec(file);
      if (match?.[1]) sdkTarballs[`@gixcopilot/${match[1]}`] = `file:${resolve(io.cwd, sdkPath, file).replaceAll('\\', '/')}`;
    }
  }
  const files = templateFiles({ name, template, sdkVersion: str(flags, 'sdk-version'), sdkTarballs });
  io.out(`Creating a ${template} copilot project "${name}" in ${directory}`);
  const code = reportWrite(io, await writePlan(directory, files, { force: flags['force'] === true, dryRun: flags['dry-run'] === true }));
  if (code === 0) io.out(`\nNext:\n  cd ${args[0] ?? '.'}\n  cp .env.example .env\n  npm install && npm run build && npm test`);
  return code;
}

/* ------------------------------------------------------------------------------ add tool / agent */

export async function addTool(io: CliIo, slug: string | undefined, flags: Flags): Promise<number> {
  if (!slug) {
    io.err('Usage: aicopilot add tool <namespace-action>   e.g. aicopilot add tool applications-get');
    return 2;
  }
  const toolName = toolNameFromSlug(slug);
  const identifier = identifierFromSlug(slug);
  const file = fileSlug(slug);
  const directory = str(flags, 'dir') ?? 'src/tools';
  const files: PlannedFile[] = [
    { path: `${directory}/${file}.ts`, content: toolFile(toolName, identifier) },
    { path: `${directory}/${file}.spec.ts`, content: toolSpec(toolName, identifier, file) },
  ];
  const code = reportWrite(io, await writePlan(io.cwd, files, { force: flags['force'] === true }));
  if (code !== 0) return code;
  const index = join(io.cwd, directory, 'index.ts');
  if (existsSync(index)) {
    const source = await readFile(index, 'utf8');
    if (source.includes('export const tools')) {
      await appendExport(index, `import { ${identifier} } from './${file}.js';\ntools.push(${identifier});`);
      io.out(`  registered ${toolName} in ${directory}/index.ts`);
    }
  }
  io.out(`\nTool "${toolName}" is classified read-only with no approval. Review its risk before use.`);
  return 0;
}

export async function addAgent(io: CliIo, slug: string | undefined, flags: Flags): Promise<number> {
  if (!slug) {
    io.err('Usage: aicopilot add agent <name>   e.g. aicopilot add agent support');
    return 2;
  }
  const agentId = fileSlug(slug);
  const identifier = identifierFromSlug(slug);
  const directory = str(flags, 'dir') ?? 'src/agents';
  const code = reportWrite(
    io,
    await writePlan(io.cwd, [
      { path: `${directory}/${agentId}.ts`, content: agentFile(agentId, identifier) },
      { path: `${directory}/${agentId}.spec.ts`, content: agentSpec(agentId, identifier, agentId) },
    ], { force: flags['force'] === true }),
  );
  if (code !== 0) return code;
  const index = join(io.cwd, directory, 'index.ts');
  if (existsSync(index) && (await readFile(index, 'utf8')).includes('export const agents')) {
    await appendExport(index, `import { ${identifier}Agent } from './${agentId}.js';\nagents.push(${identifier}Agent);`);
    io.out(`  registered agent "${agentId}" in ${directory}/index.ts`);
  }
  return 0;
}

/* ------------------------------------------------------------------------------ OpenAPI */

export async function importOpenApi(io: CliIo, file: string | undefined, flags: Flags): Promise<number> {
  if (!file) {
    io.err('Usage: aicopilot import-openapi <openapi.yaml|json> [--id <integration-id>]');
    return 2;
  }
  const text = await readFile(resolve(io.cwd, file), 'utf8');
  const document: unknown = text.trimStart().startsWith('{') ? JSON.parse(text) : parseYaml(text);
  const integrationId = fileSlug(str(flags, 'id') ?? basename(file).replace(/\.(ya?ml|json)$/i, ''));
  let keys: string[];
  try {
    keys = discoverOperations(resolveLocalRefs(document) as never).map((candidate) => operationKey(candidate));
  } catch (error) {
    io.err(`Invalid OpenAPI document: ${(error as Error).message}`);
    return 1;
  }
  // Inspection only: list every operation (even deny-by-default methods) so the developer can decide.
  const inspected = await inspectOpenAPI({ integrationId, source: { kind: 'object', document: document as never }, include: keys, operations: Object.fromEntries(keys.map((key) => [key, { expose: true }])) });
  if (inspected.report.documentIssues.length > 0) {
    for (const issue of inspected.report.documentIssues) io.err(`  ${issue.path}: ${issue.problem}`);
    return 1;
  }
  // Nothing is enabled: the developer opts operations in explicitly (Section 31).
  const operations = Object.fromEntries(
    inspected.tools.map((tool) => {
      const source = tool.metadata?.custom as { operationId?: string; method?: string; path?: string } | undefined;
      const key = source?.operationId ?? `${String(source?.method ?? '').toUpperCase()} ${String(source?.path ?? '')}`;
      return [key, { expose: false, toolName: tool.name, method: source?.method, path: source?.path, risk: tool.security?.risk, approval: tool.security?.approval }];
    }),
  );
  const configPath = `aicopilot.openapi.${integrationId}.json`;
  const integrationPath = `src/integrations/${integrationId}.ts`;
  const code = reportWrite(
    io,
    await writePlan(io.cwd, [
      { path: configPath, content: `${JSON.stringify({ integrationId, source: file.replaceAll('\\', '/'), operations }, null, 2)}\n` },
      {
        path: integrationPath,
        content: `import { readFile } from 'node:fs/promises';
import { registerOpenAPI } from '@gixcopilot/openapi';
import type { ToolRegistry } from '@gixcopilot/tools';

/**
 * ${integrationId} OpenAPI integration, generated by \`aicopilot import-openapi\`. Operations are
 * exposed ONLY when set to \`"expose": true\` in ${configPath}; generated tools still pass the
 * Action Firewall, and mutating methods require approval by default.
 */
export async function register${identifierFromSlug(integrationId).replace(/^./, (char) => char.toUpperCase())}(registry: ToolRegistry, baseUrl: string) {
  const config = JSON.parse(await readFile(new URL('../../${configPath}', import.meta.url), 'utf8')) as { operations: Record<string, { expose: boolean }> };
  const include = Object.entries(config.operations).filter(([, operation]) => operation.expose).map(([key]) => key);
  return registerOpenAPI({ integrationId: '${integrationId}', source: { kind: 'file', path: new URL('../../${file.replaceAll('\\', '/')}', import.meta.url).pathname }, baseUrl, include, registry });
}
`,
      },
    ], { force: flags['force'] === true }),
  );
  if (code !== 0) return code;
  io.out(`\nFound ${inspected.report.operationsDiscovered} operations. All are DISABLED. Set "expose": true in ${configPath} for the ones the copilot may use.`);
  return 0;
}

/* ------------------------------------------------------------------------------ MCP */

interface McpFile {
  readonly servers: Record<string, { readonly transport: 'stdio' | 'streamableHttp'; readonly command?: string; readonly args?: readonly string[]; readonly url?: string; readonly include: readonly string[] }>;
}

export async function addMcp(io: CliIo, serverId: string | undefined, flags: Flags): Promise<number> {
  const id = serverId ? fileSlug(serverId) : undefined;
  const command = str(flags, 'command');
  const url = str(flags, 'url');
  if (!id || (!command && !url) || (command && url)) {
    io.err('Usage: aicopilot add mcp <server-id> (--command "<cmd args>" | --url <https://...>)');
    return 2;
  }
  if (url && !/^https?:\/\//.test(url)) {
    io.err('--url must be http(s).');
    return 2;
  }
  const path = join(io.cwd, 'aicopilot.mcp.json');
  const current = (await readJson<McpFile>(path)) ?? { servers: {} };
  if (current.servers[id] && flags['force'] !== true) {
    io.err(`MCP server "${id}" is already configured (use --force to replace).`);
    return 1;
  }
  const [executable, ...args] = (command ?? '').split(/\s+/).filter(Boolean);
  current.servers[id] = url ? { transport: 'streamableHttp', url, include: [] } : { transport: 'stdio', command: executable, args, include: [] };
  await writePlan(io.cwd, [{ path: 'aicopilot.mcp.json', content: `${JSON.stringify(current, null, 2)}\n` }], { force: true });
  io.out(`Configured MCP server "${id}". No tools are exposed until you list them in "include" (credentials belong in the server environment, not in this file).`);
  return 0;
}

export async function listMcp(io: CliIo): Promise<number> {
  const current = await readJson<McpFile>(join(io.cwd, 'aicopilot.mcp.json'));
  if (!current || Object.keys(current.servers).length === 0) {
    io.out('No MCP servers configured. Add one with: aicopilot add mcp <id> --url https://...');
    return 0;
  }
  for (const [id, server] of Object.entries(current.servers)) io.out(`${id}\t${server.transport}\t${server.url ?? server.command ?? ''}\texposed tools: ${server.include.length}`);
  return 0;
}

/* ------------------------------------------------------------------------------ dev / test */

function runScript(io: CliIo, script: string, extra: readonly string[], env: Record<string, string>): Promise<number> {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  return new Promise((resolvePromise) => {
    const child = spawn(npm, ['run', script, ...(extra.length > 0 ? ['--', ...extra] : [])], { cwd: io.cwd, env: { ...process.env, ...env }, stdio: 'inherit', shell: process.platform === 'win32' });
    child.on('exit', (code) => resolvePromise(code ?? 1));
    child.on('error', () => resolvePromise(1));
  });
}

async function hasScript(io: CliIo, script: string): Promise<boolean> {
  const pkg = await readJson<{ scripts?: Record<string, string> }>(join(io.cwd, 'package.json'));
  return Boolean(pkg?.scripts?.[script]);
}

export async function dev(io: CliIo, extra: readonly string[]): Promise<number> {
  try {
    const config = await loadConfig({ file: existsSync(join(io.cwd, 'aicopilot.config.json')) ? join(io.cwd, 'aicopilot.config.json') : undefined, env: io.env });
    io.out(`Configuration OK (${config.environment}); sources: ${config.sources.join(' < ')}`);
  } catch (error) {
    io.err(error instanceof ConfigError ? error.message : `Configuration check failed: ${(error as Error).message}`);
    return 1;
  }
  if (!(await hasScript(io, 'dev'))) {
    io.err('No "dev" script in package.json. aicopilot dev validates configuration, then runs your own dev script.');
    return 1;
  }
  return runScript(io, 'dev', extra, { AICOPILOT_ENV: io.env['AICOPILOT_ENV'] ?? 'development' });
}

export async function test(io: CliIo, extra: readonly string[]): Promise<number> {
  if (!(await hasScript(io, 'test'))) {
    io.err('No "test" script in package.json.');
    return 1;
  }
  return runScript(io, 'test', extra, { AICOPILOT_ENV: 'test', NODE_ENV: 'test' });
}

/* ------------------------------------------------------------------------------ eval */

interface EvalSuite {
  readonly dataset: EvalDataset;
  readonly target: EvalTarget;
  readonly evaluators?: readonly Evaluator[];
  readonly gates?: GateThresholds;
  readonly repetitions?: number;
}

export async function evalCommand(io: CliIo, suitePath: string | undefined, flags: Flags): Promise<number> {
  if (!suitePath) {
    io.err('Usage: aicopilot eval <suite.js> [--json] [--baseline run.json] [--out run.json]');
    return 2;
  }
  const module = (await import(pathToFileURL(resolve(io.cwd, suitePath)).href)) as { default?: EvalSuite } & Partial<EvalSuite>;
  const suite = module.default ?? (module as EvalSuite);
  if (!suite.dataset || typeof suite.target !== 'function') {
    io.err('The suite module must export { dataset, target } (default export or named).');
    return 2;
  }
  const runner = createEvalRunner({ target: suite.target, evaluators: suite.evaluators, repetitions: suite.repetitions });
  const run = await runner.run(suite.dataset);
  const baselinePath = str(flags, 'baseline');
  const baseline = baselinePath ? ((await readJson<{ run: EvalRun }>(resolve(io.cwd, baselinePath)))?.run ?? (await readJson<EvalRun>(resolve(io.cwd, baselinePath)))) : undefined;
  const { compareEvalRuns } = await import('@gixcopilot/evals');
  const comparison = baseline ? compareEvalRuns(baseline, run) : undefined;
  const gate = evaluateGates(run, suite.gates ?? {}, comparison);
  const json = toEvalJson(run, { comparison, gate });
  const out = str(flags, 'out');
  if (out) await writePlan(io.cwd, [{ path: out, content: `${json}\n` }], { force: true });
  io.out(flags['json'] === true ? json : renderEvalReport(run, { comparison, gate }));
  return gate.passed ? 0 : 1;
}

/* ------------------------------------------------------------------------------ doctor */

interface Check {
  readonly name: string;
  readonly status: 'ok' | 'warn' | 'fail' | 'skip';
  readonly detail: string;
}

function tcpReachable(url: string, timeoutMs = 2000): Promise<boolean> {
  return new Promise((resolvePromise) => {
    try {
      const parsed = new URL(url);
      const port = Number(parsed.port || (parsed.protocol === 'https:' ? 443 : parsed.protocol.startsWith('redis') ? 6379 : parsed.protocol.startsWith('postgres') ? 5432 : 80));
      const socket = connect({ host: parsed.hostname, port, timeout: timeoutMs });
      socket.once('connect', () => {
        socket.destroy();
        resolvePromise(true);
      });
      socket.once('timeout', () => {
        socket.destroy();
        resolvePromise(false);
      });
      socket.once('error', () => resolvePromise(false));
    } catch {
      resolvePromise(false);
    }
  });
}

export async function doctor(io: CliIo, flags: Flags): Promise<number> {
  const checks: Check[] = [];
  const [major = 0, minor = 0] = process.versions.node.split('.').map(Number);
  checks.push({ name: 'node', status: major > 22 || (major === 22 && minor >= 12) ? 'ok' : 'fail', detail: `Node ${process.versions.node} (requires >= 22.12)` });
  const npmVersion = /npm\/(\d+)\./.exec(io.env['npm_config_user_agent'] ?? '')?.[1];
  if (npmVersion && Number(npmVersion) < 11) checks.push({ name: 'npm', status: 'warn', detail: `npm ${npmVersion} cannot install Vitest's dependency tree; use npm 11+ or pnpm` });
  let config: Awaited<ReturnType<typeof loadConfig>> | undefined;
  try {
    const file = join(io.cwd, 'aicopilot.config.json');
    config = await loadConfig({ file: existsSync(file) ? file : undefined, env: io.env });
    checks.push({ name: 'configuration', status: 'ok', detail: `valid (${config.environment}; ${config.sources.join(' < ')})` });
  } catch (error) {
    checks.push({ name: 'configuration', status: 'fail', detail: error instanceof ConfigError ? error.issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ') : 'could not load' });
  }
  if (config) {
    const described = describeConfig(config) as { models: { providers: Record<string, { apiKey: { configured: boolean } }> } };
    const providers = Object.entries(described.models.providers);
    checks.push({
      name: 'model providers',
      status: config.models.default ? 'ok' : 'warn',
      detail: `${config.models.default ? `default ${config.models.default.provider}/${config.models.default.model}` : 'no default model (development mock only)'}; keys configured: ${providers.filter(([, provider]) => provider.apiKey.configured).map(([id]) => id).join(', ') || 'none'}`,
    });
    const databaseUrl = config.secrets.databaseUrl?.reveal();
    if (databaseUrl) {
      const reachable = await tcpReachable(databaseUrl);
      let migrations = '';
      if (reachable && flags['skip-migrations'] !== true) {
        try {
          const { createPostgresPersistence } = await import('@gixcopilot/persistence-postgres');
          const persistence = createPostgresPersistence({ connectionString: databaseUrl, poolMax: 1 });
          const status = await persistence.migrator.status();
          await persistence.close();
          const pending = status.filter((migration) => !migration.applied).length;
          const modified = status.filter((migration) => migration.modified).length;
          migrations = modified > 0 ? `; ${modified} applied migrations were MODIFIED` : `; ${pending} pending migrations`;
          checks.push({ name: 'migrations', status: modified > 0 ? 'fail' : pending > 0 ? 'warn' : 'ok', detail: migrations.slice(2) });
        } catch {
          checks.push({ name: 'migrations', status: 'fail', detail: 'could not read migration status' });
        }
      }
      checks.push({ name: 'database', status: reachable ? 'ok' : 'fail', detail: reachable ? 'reachable' : 'not reachable (host/port)' });
    } else {
      checks.push({ name: 'database', status: config.environment === 'development' || config.environment === 'test' ? 'skip' : 'fail', detail: 'DATABASE_URL not set' });
    }
    const redisUrl = config.secrets.redisUrl?.reveal();
    checks.push(redisUrl ? { name: 'redis', status: (await tcpReachable(redisUrl)) ? 'ok' : 'fail', detail: 'REDIS_URL host/port' } : { name: 'redis', status: 'skip', detail: 'REDIS_URL not set (single-instance limits only)' });
    checks.push(config.telemetry.otlpEndpoint ? { name: 'telemetry', status: (await tcpReachable(config.telemetry.otlpEndpoint)) ? 'ok' : 'warn', detail: `OTLP endpoint ${new URL(config.telemetry.otlpEndpoint).host}; mode ${config.telemetry.mode}` } : { name: 'telemetry', status: 'ok', detail: `mode ${config.telemetry.mode}; no OTLP endpoint configured` });
  }
  // Tool registry: unclassified tools are held for approval by the default risk policy.
  const toolsDir = join(io.cwd, 'src', 'tools');
  if (existsSync(toolsDir)) {
    const files = (await readdir(toolsDir)).filter((file) => file.endsWith('.ts') && !file.endsWith('.spec.ts') && file !== 'index.ts');
    const unclassified: string[] = [];
    for (const file of files) if (!/risk:\s*'(read-only|write|destructive)'/.test(await readFile(join(toolsDir, file), 'utf8'))) unclassified.push(file);
    checks.push({ name: 'tool registry', status: unclassified.length > 0 ? 'warn' : 'ok', detail: `${files.length} tool files${unclassified.length > 0 ? `; no risk classification: ${unclassified.join(', ')}` : ''}` });
  }
  for (const file of (await readdir(io.cwd)).filter((name) => /^aicopilot\.openapi\..+\.json$/.test(name))) {
    const spec = await readJson<{ operations: Record<string, { expose: boolean }> }>(join(io.cwd, file));
    const operations = Object.values(spec?.operations ?? {});
    checks.push({ name: `openapi ${file}`, status: spec ? 'ok' : 'fail', detail: `${operations.filter((operation) => operation.expose).length}/${operations.length} operations exposed` });
  }
  const mcp = await readJson<McpFile>(join(io.cwd, 'aicopilot.mcp.json'));
  for (const [id, server] of Object.entries(mcp?.servers ?? {})) {
    if (server.url) checks.push({ name: `mcp ${id}`, status: (await tcpReachable(server.url)) ? 'ok' : 'warn', detail: `${new URL(server.url).host}; ${server.include.length} tools exposed` });
    else checks.push({ name: `mcp ${id}`, status: server.command ? 'ok' : 'fail', detail: `stdio command configured; ${server.include.length} tools exposed` });
  }

  if (flags['json'] === true) io.out(JSON.stringify({ checks }, null, 2));
  else for (const check of checks) io.out(`${check.status.toUpperCase().padEnd(5)} ${check.name.padEnd(22)} ${check.detail}`);
  return checks.some((check) => check.status === 'fail') ? 1 : 0;
}

/* ------------------------------------------------------------------------------ db */

export async function db(io: CliIo, action: string | undefined, flags: Flags): Promise<number> {
  const config = await loadConfig({ env: io.env }).catch((error: unknown) => {
    io.err(error instanceof ConfigError ? error.message : 'Configuration failed.');
    return undefined;
  });
  const url = config?.secrets.databaseUrl?.reveal();
  if (!url) {
    io.err('DATABASE_URL is required.');
    return 1;
  }
  const { createPostgresPersistence } = await import('@gixcopilot/persistence-postgres');
  const persistence = createPostgresPersistence({ connectionString: url, poolMax: 1 });
  try {
    if (action === 'status') {
      for (const migration of await persistence.migrator.status()) io.out(`${migration.applied ? 'applied' : 'pending'}${migration.modified ? ' (MODIFIED)' : ''}\t${migration.id}${migration.reversible ? '' : '\t(no down file)'}`);
      return 0;
    }
    if (action === 'migrate') {
      const applied = await persistence.migrator.up();
      io.out(applied.length > 0 ? applied.map((id) => `applied ${id}`).join('\n') : 'Database is up to date.');
      return 0;
    }
    if (action === 'rollback') {
      // Destructive: never without an explicit --yes, including in CI (Section 38).
      if (flags['yes'] !== true) {
        io.err('Rollback drops tables and data. Re-run with --yes after taking a backup.');
        return 1;
      }
      const reverted = await persistence.migrator.rollbackLast();
      io.out(reverted ? `reverted ${reverted}` : 'Nothing to roll back.');
      return 0;
    }
    io.err('Usage: aicopilot db <status|migrate|rollback --yes>');
    return 2;
  } catch (error) {
    io.err(`Database command failed: ${(error as Error).message}`);
    return 1;
  } finally {
    await persistence.close();
  }
}
