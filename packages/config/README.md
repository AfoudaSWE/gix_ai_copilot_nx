# @gixcopilot/config

One typed production configuration model for AI Copilot servers and workers (**Beta**).

```ts
import { loadConfig, describeConfig } from '@gixcopilot/config';

const config = await loadConfig({ file: 'aicopilot.config.json' }); // throws ConfigError on problems
logger.info({ config: describeConfig(config) }, 'configuration loaded');   // secrets shown as { configured, source }
const pool = new Pool({ connectionString: config.secrets.databaseUrl?.reveal() });
```

**Precedence** (lowest first): schema defaults < config file (JSON) < environment variables <
code `overrides`. Environments: `development`, `test`, `staging`, `production`
(`AICOPILOT_ENV`, or `NODE_ENV` when it is one of those).

**Validation** happens once, at startup, and reports every problem by path, never by value.
Unknown keys are errors. In `staging` and `production`: `DATABASE_URL` is required,
authentication must be required, `development-verbose` telemetry and the mock model provider
are rejected; DevTools is rejected in production and always needs a token.

**Secrets** never appear in the config data itself. A config file holds references
(`{ "secret": "OPENAI_API_KEY" }`); environment variables such as `DATABASE_URL`, `REDIS_URL`
and `<PROVIDER>_API_KEY` become references automatically. References resolve through a
`SecretProvider`: `createEnvSecretProvider`, `createFileSecretProvider('/run/secrets')`
(Docker/Kubernetes), `composeSecretProviders`, or your own for a vault. Resolved values are
`Secret` objects that print `[secret]` in `String()`, `JSON.stringify` and `console.log`; only
`reveal()` returns the value.

The full environment-variable table is `ENV_MAPPING` and
[docs/production/CONFIGURATION.md](../../docs/production/CONFIGURATION.md). Server-only.
