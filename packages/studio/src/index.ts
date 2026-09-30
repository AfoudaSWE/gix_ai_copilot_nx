export {
  assertApplicationPlane,
  DEVELOPMENT_AGENTS,
  DEVELOPMENT_CAPABILITIES,
  DEVELOPMENT_SKILLS,
  DEVELOPMENT_TOOLS,
  isDevelopmentAgentOrSkill,
  isDevelopmentToolName,
  PlaneViolationError,
  RESERVED_DEVELOPMENT_NAMESPACES,
} from './planes.js';
export type { CapabilityDescriptor, CapabilityKind, Plane, ToolNameSource } from './planes.js';

export { createWorkspaceGuard, isSecretPath, WorkspaceViolationError } from './workspace/guard.js';
export type { WorkspaceGuard } from './workspace/guard.js';
export { createReadonlyWorkspace, DEFAULT_WORKSPACE_LIMITS, SecretFileError } from './workspace/workspace.js';
export type { ListFilesOptions, ListFilesResult, ReadonlyWorkspace, WorkspaceFile, WorkspaceLimits } from './workspace/workspace.js';

export { discoverProject } from './discovery/discover.js';
export type { DiscoverProjectOptions } from './discovery/discover.js';
export { DEFAULT_DETECTORS } from './discovery/detectors.js';
export type { DetectionInput, PackageManifest, ProjectDetector } from './discovery/detectors.js';
export { compareDiscoveries } from './discovery/rescan.js';
export { classifyProject } from './discovery/classify.js';
export type { ApplicationRole, ClassifiedApplication, ProjectClassification, ProjectClassificationResult } from './discovery/classify.js';
export { canonicalOperationKey, normalizeApiOperations } from './discovery/normalize.js';
export { analyzePages } from './discovery/pages.js';
export type { DiscoveryComparison } from './discovery/rescan.js';
export type * from './discovery/model.js';

export type * from './proposals/model.js';
export { applyEdits, ProposalEditError, proposalEditSchema } from './proposals/edit.js';
export type { ProposalEdit } from './proposals/edit.js';
export { reviewProposalSecurity } from './proposals/security-review.js';
export { assertTransition, createFileProposalStore, createProposalStore, ProposalStateError } from './proposals/store.js';
export type { ProposalStore } from './proposals/store.js';
export { safeSelection } from './proposals/safe.js';

export type { AnyGenerator, GeneratedDraft, Generator, GeneratorContext, GeneratorInput, RenderedFile } from './generators/contract.js';
export { runGenerator } from './generators/pipeline.js';
export { apiToolsGenerator, openApiToolsGenerator } from './generators/api-tools.js';
export { contextGenerator, generativeUiGenerator, securityPolicyGenerator } from './generators/application-generators.js';
export { agentGenerator, configurationGenerator, COPILOT_CONFIG_FILE, knowledgeGenerator, skillGenerator } from './generators/project-generators.js';
export { appIntegrationGenerator, COPILOT_API_PREFIX, COPILOT_SERVER_URL, routePattern } from './generators/app-integration.js';
export { approvalFloor, suggestPermission, suggestRisk, toolNameFor } from './generators/risk.js';

export { ApplyRefusedError, createApplyEngine } from './apply/engine.js';
export type { ApplyEngine, ApplyEngineOptions, CommandRunner, ValidationStep } from './apply/engine.js';
export { unifiedDiff } from './apply/diff.js';
export { redactSecrets, scanForSecrets } from './apply/secret-scan.js';
export type { SecretFinding } from './apply/secret-scan.js';

export { computeDiagnostics } from './diagnostics.js';
export type { HealthRow, HealthStatus, LifecycleStage, RuntimeFacts, StudioDiagnostics } from './diagnostics.js';

export { createModelSettingsStore, modelSettingsSchema } from './configuration/model-settings.js';
export type { ConnectionTestResult, ModelSettingsInput, ModelSettingsStore, ProviderFactory, ProviderSettings, PublicModelSettings } from './configuration/model-settings.js';
export { redactConfig } from './configuration/redact.js';

export { createStudioService, DEFAULT_GENERATORS, PROPOSALS_DIRECTORY, StudioApprovalError, StudioNotFoundError } from './service.js';
export type { HostToolView, ProposalView, SecuritySummary, StudioConfigView, StudioService, StudioServiceOptions, StudioStatus } from './service.js';
