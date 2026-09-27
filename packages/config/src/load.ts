import { readFile } from 'node:fs/promises';
import { copilotConfigSchema, ENVIRONMENTS } from './schema.js';
import type { CopilotConfigData, CopilotConfigInput, DeploymentEnvironment, SecretRef } from './schema.js';
import { createEnvSecretProvider, isSecret } from './secret.js';
import type { Secret, SecretProvider } from './secret.js';

/** A configuration problem, reported by path with no values (values may be secrets). */
export interface ConfigIssue {
  readonly path: string;
  readonly message: string;
}

export class ConfigError extends Error {
  readonly issues: readonly ConfigIssue[];

  constructor(issues: readonly ConfigIssue[]) {
    super(`Invalid configuration:\n${issues.map((issue) => `  - ${issue.path}: ${issue.message}`).join('\n')}`);
    this.name = 'ConfigError';
    this.issues = issues;
  }
}

/** Resolved secrets, keyed by config path. Only `Secret` objects, never plain strings. */
export interface ResolvedSecrets {
  readonly databaseUrl?: Secret;
  readonly redisUrl?: Secret;
  readonly devtoolsToken?: Secret;
  readonly jwtSecret?: Secret;
  readonly metricsToken?: Secret;
  readonly managementSecretKey?: Secret;
  readonly providerApiKeys: Readonly<Record<string, Secret>>;
}

export interface CopilotConfig extends CopilotConfigData {
  readonly secrets: ResolvedSecrets;
  /** Which source supplied each top-level section, for `doctor` and startup logs. */
  readonly sources: readonly string[];
}

export interface LoadConfigOptions {
  /** A JSON config file (e.g. `aicopilot.config.json`). Missing file is an error only if `required`. */
  readonly file?: string;
  readonly fileRequired?: boolean;
  /** Environment variables (defaults to `process.env`). */
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** Highest-precedence values from code. */
  readonly overrides?: CopilotConfigInput;
  /** Resolves `{ secret: NAME }` references. Defaults to the environment. */
  readonly secrets?: SecretProvider;
}

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function merge(base: Json, next: Json): Json {
  const out: Json = { ...base };
  for (const [key, value] of Object.entries(next)) {
    if (value === undefined) continue;
    const current = out[key];
    out[key] = isObject(current) && isObject(value) && !('secret' in value) ? merge(current, value) : value;
  }
  return out;
}

function setPath(target: Json, path: readonly string[], value: unknown): void {
  let node = target;
  for (const key of path.slice(0, -1)) {
    const next = node[key];
    node[key] = isObject(next) ? next : {};
    node = node[key] as Json;
  }
  const last = path.at(-1);
  if (last !== undefined) node[last] = value;
}

const bool = (value: string): boolean | string => (value === 'true' || value === '1' ? true : value === 'false' || value === '0' ? false : value);

/**
 * The documented environment-variable mapping. Secrets map to secret *references* (the name
 * of the variable), so the value itself is only ever read through the SecretProvider.
 */
export const ENV_MAPPING: readonly { readonly variable: string; readonly path: readonly string[]; readonly kind: 'string' | 'boolean' | 'secret' | 'list' }[] = [
  { variable: 'AICOPILOT_ENV', path: ['environment'], kind: 'string' },
  { variable: 'AICOPILOT_SERVICE_NAME', path: ['service', 'name'], kind: 'string' },
  { variable: 'HOST', path: ['service', 'host'], kind: 'string' },
  { variable: 'PORT', path: ['service', 'port'], kind: 'string' },
  { variable: 'LOG_LEVEL', path: ['service', 'logLevel'], kind: 'string' },
  { variable: 'AICOPILOT_SHUTDOWN_GRACE_SECONDS', path: ['service', 'shutdownGraceSeconds'], kind: 'string' },
  { variable: 'DATABASE_URL', path: ['database', 'url'], kind: 'secret' },
  { variable: 'DATABASE_POOL_MAX', path: ['database', 'poolMax'], kind: 'string' },
  { variable: 'REDIS_URL', path: ['redis', 'url'], kind: 'secret' },
  { variable: 'AICOPILOT_REQUIRE_AUTH', path: ['security', 'requireAuthentication'], kind: 'boolean' },
  { variable: 'AICOPILOT_CORS_ORIGINS', path: ['security', 'corsOrigins'], kind: 'list' },
  { variable: 'AICOPILOT_JWT_SECRET', path: ['security', 'jwt', 'secret'], kind: 'secret' },
  { variable: 'AICOPILOT_JWT_ISSUER', path: ['security', 'jwt', 'issuer'], kind: 'string' },
  { variable: 'AICOPILOT_JWT_AUDIENCE', path: ['security', 'jwt', 'audience'], kind: 'string' },
  { variable: 'AICOPILOT_METRICS_TOKEN', path: ['telemetry', 'metricsToken'], kind: 'secret' },
  { variable: 'AICOPILOT_SECRET_KEY', path: ['management', 'secretKey'], kind: 'secret' },
  { variable: 'AICOPILOT_RETENTION_CONVERSATION_DAYS', path: ['retention', 'conversationDays'], kind: 'string' },
  { variable: 'AICOPILOT_RETENTION_AUDIT_DAYS', path: ['retention', 'auditDays'], kind: 'string' },
  { variable: 'AICOPILOT_RETENTION_USAGE_DAYS', path: ['retention', 'usageDays'], kind: 'string' },
  { variable: 'AICOPILOT_TELEMETRY_MODE', path: ['telemetry', 'mode'], kind: 'string' },
  { variable: 'OTEL_EXPORTER_OTLP_ENDPOINT', path: ['telemetry', 'otlpEndpoint'], kind: 'string' },
  { variable: 'AICOPILOT_TRACE_SAMPLE_RATIO', path: ['telemetry', 'traceSampleRatio'], kind: 'string' },
  { variable: 'AICOPILOT_METRICS_ENABLED', path: ['telemetry', 'metricsEnabled'], kind: 'boolean' },
  { variable: 'AICOPILOT_DEVTOOLS_ENABLED', path: ['devtools', 'enabled'], kind: 'boolean' },
  { variable: 'AICOPILOT_DEVTOOLS_TOKEN', path: ['devtools', 'token'], kind: 'secret' },
  { variable: 'AICOPILOT_MANAGEMENT_ENABLED', path: ['management', 'enabled'], kind: 'boolean' },
];

function fromEnv(env: Readonly<Record<string, string | undefined>>): Json {
  const out: Json = {};
  const nodeEnv = env['NODE_ENV'];
  if (nodeEnv && (ENVIRONMENTS as readonly string[]).includes(nodeEnv)) out['environment'] = nodeEnv;
  for (const { variable, path, kind } of ENV_MAPPING) {
    const value = env[variable];
    if (value === undefined || value === '') continue;
    if (kind === 'secret') setPath(out, path, { secret: variable } satisfies SecretRef);
    else if (kind === 'boolean') setPath(out, path, bool(value));
    else if (kind === 'list') setPath(out, path, value.split(',').map((item) => item.trim()).filter(Boolean));
    else setPath(out, path, value);
  }
  // Model default + provider keys: AICOPILOT_MODEL_PROVIDER / AICOPILOT_MODEL, and
  // <PROVIDER>_API_KEY for each known provider id (OPENAI_API_KEY -> providers.openai).
  const provider = env['AICOPILOT_MODEL_PROVIDER'];
  const model = env['AICOPILOT_MODEL'] ?? (provider === 'openai' ? env['OPENAI_MODEL'] : undefined);
  if (provider && model) setPath(out, ['models', 'default'], { provider, model });
  for (const [variable, value] of Object.entries(env)) {
    const match = /^([A-Z][A-Z0-9]*)_API_KEY$/.exec(variable);
    if (!match?.[1] || !value || ['AICOPILOT'].includes(match[1])) continue;
    setPath(out, ['models', 'providers', match[1].toLowerCase(), 'apiKey'], { secret: variable } satisfies SecretRef);
  }
  return out;
}

function environmentRules(config: CopilotConfigData, secrets: ResolvedSecrets): ConfigIssue[] {
  const issues: ConfigIssue[] = [];
  const hardened = config.environment === 'staging' || config.environment === 'production';
  if (hardened) {
    if (!secrets.databaseUrl) issues.push({ path: 'database.url', message: `DATABASE_URL is required in ${config.environment}` });
    if (!config.security.requireAuthentication)
      issues.push({ path: 'security.requireAuthentication', message: `must be true in ${config.environment} (set AICOPILOT_REQUIRE_AUTH=true)` });
    if (config.telemetry.mode === 'development-verbose')
      issues.push({ path: 'telemetry.mode', message: `development-verbose records raw payloads and is not allowed in ${config.environment}` });
  }
  if (config.environment === 'production' && config.devtools.enabled)
    issues.push({ path: 'devtools.enabled', message: 'DevTools must not be enabled in production' });
  if (config.devtools.enabled && !secrets.devtoolsToken)
    issues.push({ path: 'devtools.token', message: 'DevTools requires AICOPILOT_DEVTOOLS_TOKEN (it is never exposed unauthenticated)' });
  if (config.management.enabled && !secrets.managementSecretKey)
    issues.push({ path: 'management.secretKey', message: 'the management platform requires AICOPILOT_SECRET_KEY (encrypts stored secrets)' });
  if (config.telemetry.metricsEnabled && hardened && !secrets.metricsToken)
    issues.push({ path: 'telemetry.metricsToken', message: `/metrics requires AICOPILOT_METRICS_TOKEN in ${config.environment}` });
  if (config.models.default) {
    const { provider } = config.models.default;
    const known = config.models.providers[provider];
    if (provider !== 'mock' && known?.enabled !== false && !secrets.providerApiKeys[provider] && !known?.baseUrl)
      issues.push({ path: `models.providers.${provider}.apiKey`, message: `the default model's provider "${provider}" has no API key configured` });
    if (known?.enabled === false) issues.push({ path: `models.providers.${provider}.enabled`, message: 'the default model uses a disabled provider' });
    if (hardened && provider === 'mock') issues.push({ path: 'models.default.provider', message: `the mock provider is for development and tests, not ${config.environment}` });
  }
  return issues;
}

async function resolveSecret(ref: SecretRef | undefined, provider: SecretProvider, path: string, issues: ConfigIssue[]): Promise<Secret | undefined> {
  if (!ref) return undefined;
  const secret = await provider.get(ref.secret);
  if (!secret) issues.push({ path, message: `secret "${ref.secret}" was referenced but not found in ${provider.name}` });
  return secret;
}

/**
 * Loads, merges and validates configuration, then resolves secret references. Precedence
 * (lowest first): schema defaults < config file < environment variables < code overrides.
 * Throws `ConfigError` listing every problem (paths only, never values) so a misconfigured
 * process fails at startup instead of on the first request.
 */
export async function loadConfig(options: LoadConfigOptions = {}): Promise<CopilotConfig> {
  const env = options.env ?? process.env;
  const sources = ['defaults'];
  let merged: Json = {};
  if (options.file) {
    try {
      const parsed: unknown = JSON.parse(await readFile(options.file, 'utf8'));
      if (!isObject(parsed)) throw new ConfigError([{ path: options.file, message: 'config file must contain a JSON object' }]);
      merged = merge(merged, parsed);
      sources.push(`file:${options.file}`);
    } catch (error) {
      if (error instanceof ConfigError) throw error;
      const missing = (error as NodeJS.ErrnoException).code === 'ENOENT';
      if (!missing || options.fileRequired)
        throw new ConfigError([{ path: options.file, message: missing ? 'config file not found' : 'config file is not valid JSON' }]);
    }
  }
  merged = merge(merged, fromEnv(env));
  sources.push('env');
  if (options.overrides) {
    merged = merge(merged, options.overrides);
    sources.push('code');
  }

  const parsed = copilotConfigSchema.safeParse(merged);
  if (!parsed.success) {
    throw new ConfigError(parsed.error.issues.map((issue) => ({ path: issue.path.join('.') || '(root)', message: issue.message })));
  }
  const config = parsed.data;
  const provider = options.secrets ?? createEnvSecretProvider(env);
  const issues: ConfigIssue[] = [];
  const providerApiKeys: Record<string, Secret> = {};
  for (const [id, entry] of Object.entries(config.models.providers)) {
    const secret = await resolveSecret(entry.apiKey, provider, `models.providers.${id}.apiKey`, issues);
    if (secret) providerApiKeys[id] = secret;
  }
  const secrets: ResolvedSecrets = {
    databaseUrl: await resolveSecret(config.database.url, provider, 'database.url', issues),
    redisUrl: await resolveSecret(config.redis.url, provider, 'redis.url', issues),
    devtoolsToken: await resolveSecret(config.devtools.token, provider, 'devtools.token', issues),
    jwtSecret: await resolveSecret(config.security.jwt.secret, provider, 'security.jwt.secret', issues),
    metricsToken: await resolveSecret(config.telemetry.metricsToken, provider, 'telemetry.metricsToken', issues),
    managementSecretKey: await resolveSecret(config.management.secretKey, provider, 'management.secretKey', issues),
    providerApiKeys,
  };
  issues.push(...environmentRules(config, secrets));
  if (issues.length > 0) throw new ConfigError(issues);
  return { ...config, secrets, sources };
}

/** Whether a feature flag is on (unknown flags are off). */
export function isFeatureEnabled(config: Pick<CopilotConfigData, 'features'>, flag: string): boolean {
  return config.features[flag] === true;
}

/** A log/doctor-safe view: secrets become `{ configured, source }`, never values. */
export function describeConfig(config: CopilotConfig): Record<string, unknown> {
  const describe = (secret: Secret | undefined) => (secret ? { configured: true, source: secret.source } : { configured: false });
  const { secrets, ...rest } = config;
  return {
    ...rest,
    database: { ...rest.database, url: describe(secrets.databaseUrl) },
    redis: { ...rest.redis, url: describe(secrets.redisUrl) },
    devtools: { ...rest.devtools, token: describe(secrets.devtoolsToken) },
    security: { ...rest.security, jwt: { ...rest.security.jwt, secret: describe(secrets.jwtSecret) } },
    telemetry: { ...rest.telemetry, metricsToken: describe(secrets.metricsToken) },
    management: { ...rest.management, secretKey: describe(secrets.managementSecretKey) },
    models: {
      ...rest.models,
      providers: Object.fromEntries(
        Object.entries(rest.models.providers).map(([id, entry]) => [id, { ...entry, apiKey: describe(secrets.providerApiKeys[id]) }]),
      ),
    },
  };
}

export function isEnvironment(value: string): value is DeploymentEnvironment {
  return (ENVIRONMENTS as readonly string[]).includes(value);
}

export { isSecret };
