import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inspect } from 'node:util';
import { describe, expect, it } from 'vitest';
import {
  ConfigError,
  Secret,
  composeSecretProviders,
  createEnvSecretProvider,
  createFileSecretProvider,
  describeConfig,
  isFeatureEnabled,
  loadConfig,
} from './index.js';

const productionEnv = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgres://app:s3cr3t-db-pass@db:5432/copilot',
  AICOPILOT_REQUIRE_AUTH: 'true',
  AICOPILOT_MODEL_PROVIDER: 'openai',
  AICOPILOT_MODEL: 'gpt-4o-mini',
  OPENAI_API_KEY: 'sk-test-not-a-real-key-000000000000',
};

async function configFile(content: unknown): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'gix-config-'));
  const file = join(dir, 'aicopilot.config.json');
  await writeFile(file, JSON.stringify(content));
  return file;
}

describe('@gixcopilot/config', () => {
  it('applies defaults for a bare development environment', async () => {
    const config = await loadConfig({ env: {} });
    expect(config.environment).toBe('development');
    expect(config.service).toMatchObject({ host: '127.0.0.1', port: 4000, logLevel: 'info' });
    expect(config.telemetry.mode).toBe('redacted');
    expect(config.devtools.enabled).toBe(false);
  });

  it('merges with explicit precedence: defaults < file < env < code', async () => {
    const file = await configFile({ service: { port: 5000, name: 'from-file' }, telemetry: { traceSampleRatio: 0.5 }, features: { 'agents.planner': true } });
    const config = await loadConfig({ file, env: { PORT: '6000', LOG_LEVEL: 'debug' }, overrides: { service: { logLevel: 'warn' } } });
    expect(config.service.name).toBe('from-file');
    expect(config.service.port).toBe(6000);
    expect(config.service.logLevel).toBe('warn');
    expect(config.telemetry.traceSampleRatio).toBe(0.5);
    expect(isFeatureEnabled(config, 'agents.planner')).toBe(true);
    expect(isFeatureEnabled(config, 'unknown.flag')).toBe(false);
    expect(config.sources).toEqual(['defaults', `file:${file}`, 'env', 'code']);
  });

  it('fails fast with every problem, by path, never printing values', async () => {
    const error = await loadConfig({ env: { NODE_ENV: 'production', OPENAI_API_KEY: 'sk-test-not-a-real-key-000000000000', AICOPILOT_MODEL_PROVIDER: 'openai', AICOPILOT_MODEL: 'x' } }).catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(ConfigError);
    const issues = (error as ConfigError).issues.map((issue) => issue.path);
    expect(issues).toEqual(expect.arrayContaining(['database.url', 'security.requireAuthentication']));
    expect((error as ConfigError).message).toContain('DATABASE_URL is required in production');
    expect((error as ConfigError).message).not.toContain('sk-test');
  });

  it('rejects unsafe production settings', async () => {
    const error = (await loadConfig({
      env: { ...productionEnv, AICOPILOT_TELEMETRY_MODE: 'development-verbose', AICOPILOT_DEVTOOLS_ENABLED: 'true' },
    }).catch((failure: unknown) => failure)) as ConfigError;
    expect(error.issues.map((issue) => issue.path)).toEqual(expect.arrayContaining(['telemetry.mode', 'devtools.enabled', 'devtools.token']));
    const mock = (await loadConfig({ env: { ...productionEnv, AICOPILOT_MODEL_PROVIDER: 'mock' } }).catch((failure: unknown) => failure)) as ConfigError;
    expect(mock.issues.map((issue) => issue.path)).toContain('models.default.provider');
  });

  it('rejects unknown keys and bad types instead of ignoring them', async () => {
    const file = await configFile({ service: { port: 'not-a-port' }, databse: {} });
    const error = (await loadConfig({ file, env: {} }).catch((failure: unknown) => failure)) as ConfigError;
    expect(error).toBeInstanceOf(ConfigError);
    expect(error.issues.length).toBeGreaterThanOrEqual(2);
  });

  it('keeps secrets out of JSON, strings, inspect and describeConfig', async () => {
    const config = await loadConfig({ env: productionEnv });
    const secret = config.secrets.providerApiKeys['openai'];
    expect(secret?.reveal()).toBe(productionEnv.OPENAI_API_KEY);
    const surfaces = [JSON.stringify(config), `${String(secret)}`, inspect(config, { depth: 10 }), JSON.stringify(describeConfig(config))];
    for (const surface of surfaces) {
      expect(surface).not.toContain('sk-test-not-a-real-key');
      expect(surface).not.toContain('s3cr3t-db-pass');
    }
    expect(describeConfig(config)).toMatchObject({ database: { url: { configured: true, source: 'env:DATABASE_URL' } } });
  });

  it('resolves secret references from mounted files, rejecting traversal', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'gix-secrets-'));
    await writeFile(join(dir, 'db_url'), 'postgres://u:p@db/copilot\n');
    const provider = composeSecretProviders(createFileSecretProvider(dir), createEnvSecretProvider({}));
    expect((await provider.get('db_url'))?.reveal()).toBe('postgres://u:p@db/copilot');
    expect(await provider.get('../etc/passwd')).toBeUndefined();
    const file = await configFile({ database: { url: { secret: 'db_url' } } });
    const config = await loadConfig({ file, env: {}, secrets: provider });
    expect(config.secrets.databaseUrl).toBeInstanceOf(Secret);
    const missing = (await loadConfig({ file: await configFile({ redis: { url: { secret: 'nope' } } }), env: {}, secrets: provider }).catch((failure: unknown) => failure)) as ConfigError;
    expect(missing.issues[0]).toMatchObject({ path: 'redis.url' });
  });

  it('requires an API key for the default model provider', async () => {
    const error = (await loadConfig({ env: { AICOPILOT_MODEL_PROVIDER: 'openai', AICOPILOT_MODEL: 'gpt-4o-mini' } }).catch((failure: unknown) => failure)) as ConfigError;
    expect(error.issues[0]?.path).toBe('models.providers.openai.apiKey');
  });
});
