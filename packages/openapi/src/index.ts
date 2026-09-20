export type {
  HttpMethod,
  OpenAPISource,
  OpenAPIDocument,
  OpenAPIParameterCandidate,
  OpenAPIOperationCandidate,
  OpenAPIToolSourceMetadata,
  OperationExposure,
  OpenAPIMethodPolicy,
  OpenAPIOperationOverride,
  RegistrationWarning,
  RegistrationConflict,
  DocumentIssue,
  OpenAPIGenerationReport,
} from './types.js';

export { createOpenAPILoader } from './loader.js';
export type { OpenAPILoader } from './loader.js';

export { resolveLocalRefs, UnresolvableReferenceError, CircularReferenceError } from './ref-resolver.js';

export { validateOpenAPIDocument } from './validator.js';
export type { ValidationIssue, ValidationResult } from './validator.js';

export { discoverOperations } from './operation-discovery.js';

export { deriveToolName, deriveFallbackName, detectNamingConflicts, operationKey } from './naming.js';

export { buildOperationInputPlan } from './input-schema.js';
export type { OperationInputField, OperationInputFieldTarget, OperationInputPlan, OperationInputResult } from './input-schema.js';

export { resolveOperationExposure } from './exposure-policy.js';
export type { ExposureDecision, ExposurePolicyOptions } from './exposure-policy.js';

export { buildSecurityMetadata } from './security-metadata.js';
export type { SecurityMetadataOptions } from './security-metadata.js';

// `CredentialProvider`/`IntegrationCredentials`/`credentialsToHeaders`/`redactSensitiveHeaders`
// live in `@gixcopilot/tools` (shared with `@gixcopilot/mcp`) - import them from there.

export { createFetchHttpExecutor, SsrfGuardError, MissingPathParameterError } from './http-executor.js';
export type { HttpExecutor, HttpExecutionRequest, HttpExecutionResult } from './http-executor.js';

export { normalizeHttpError, normalizeExecutionError } from './error-normalization.js';
export type { ErrorNormalizationContext } from './error-normalization.js';

export { shouldRetry, retryDelayMs, withRetry } from './retry.js';
export type { RetryPolicy, RetryDecisionInput } from './retry.js';

export { generateOpenAPITools } from './tool-generator.js';
export type { GenerateOpenAPIToolsOptions, GenerateOpenAPIToolsResult, OpenAPIToolResult } from './tool-generator.js';

export { inspectOpenAPI } from './inspect-openapi.js';
export type { InspectOpenAPIOptions, InspectOpenAPIResult } from './inspect-openapi.js';

export { registerOpenAPI } from './register-openapi.js';
export type { RegisterOpenAPIOptions, OpenAPIIntegration } from './register-openapi.js';
