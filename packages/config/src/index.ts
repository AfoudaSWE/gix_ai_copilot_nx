export { ConfigError, ENV_MAPPING, describeConfig, isEnvironment, isFeatureEnabled, isSecret, loadConfig } from './load.js';
export type { ConfigIssue, CopilotConfig, LoadConfigOptions, ResolvedSecrets } from './load.js';
export { ENVIRONMENTS, copilotConfigSchema, secretRefSchema } from './schema.js';
export type { CopilotConfigData, CopilotConfigInput, DeploymentEnvironment, SecretRef } from './schema.js';
export { Secret, composeSecretProviders, createEnvSecretProvider, createFileSecretProvider } from './secret.js';
export type { SecretProvider } from './secret.js';
