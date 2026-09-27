# Configuration

One typed model (`@gixcopilot/config`), validated once at startup. **Precedence** (lowest
first): schema defaults < JSON config file (`AICOPILOT_CONFIG_FILE`, e.g.
`aicopilot.config.json`) < environment variables < code overrides. Unknown keys are errors.
Invalid configuration stops the process with exit code 78 and a list of problems. The list
names paths, never values.

**Environments**: `development`, `test`, `staging`, `production` (`AICOPILOT_ENV`, or
`NODE_ENV` when it is one of these). Environment-specific behavior lives in these validation
rules, not scattered through packages. In staging and production:

- `DATABASE_URL` is required;
- authentication must be required;
- `development-verbose` telemetry and the mock provider are rejected;
- DevTools is rejected in production;
- `/metrics` needs a token when enabled;
- the platform needs `AICOPILOT_SECRET_KEY`.

| Variable | Setting |
| --- | --- |
| `AICOPILOT_ENV` / `NODE_ENV` | environment |
| `AICOPILOT_SERVICE_NAME`, `HOST`, `PORT`, `LOG_LEVEL`, `AICOPILOT_SHUTDOWN_GRACE_SECONDS` | service |
| `DATABASE_URL` (secret), `DATABASE_POOL_MAX` | PostgreSQL |
| `REDIS_URL` (secret) | Redis (rate limits, jobs) |
| `AICOPILOT_MODEL_PROVIDER`, `AICOPILOT_MODEL` (`OPENAI_MODEL` for openai) | default model |
| `<PROVIDER>_API_KEY` (secret), e.g. `OPENAI_API_KEY` | provider keys |
| `AICOPILOT_REQUIRE_AUTH`, `AICOPILOT_CORS_ORIGINS` | security |
| `AICOPILOT_JWT_SECRET` (secret), `AICOPILOT_JWT_ISSUER`, `AICOPILOT_JWT_AUDIENCE` | reference JWT authentication |
| `AICOPILOT_TELEMETRY_MODE`, `OTEL_EXPORTER_OTLP_ENDPOINT`, `AICOPILOT_TRACE_SAMPLE_RATIO` | telemetry |
| `AICOPILOT_METRICS_ENABLED`, `AICOPILOT_METRICS_TOKEN` (secret) | `/metrics` |
| `AICOPILOT_DEVTOOLS_ENABLED`, `AICOPILOT_DEVTOOLS_TOKEN` (secret) | DevTools (never production) |
| `AICOPILOT_MANAGEMENT_ENABLED`, `AICOPILOT_SECRET_KEY` (secret, 32 bytes base64) | management API |
| `AICOPILOT_RETENTION_CONVERSATION_DAYS`, `_AUDIT_DAYS`, `_USAGE_DAYS` | retention |

**Secrets** never live in the config data. Secret variables become *references*, and a config
file may contain `{ "secret": "NAME" }`. References resolve through a `SecretProvider`: the
environment, mounted files (`/run/secrets`, traversal-safe), composed providers, or your vault
adapter. Resolved `Secret` objects print `[secret]` in logs, JSON and `console.log`;
`describeConfig()` shows `{ configured, source }`. Feature flags: a plain `features` map with
`isFeatureEnabled`; unknown flags are off.
