export type { ContextScope } from './context-scope.js';
export { CONTEXT_SCOPES, isContextScope } from './context-scope.js';

export type { ContextPriority } from './context-priority.js';
export {
  CONTEXT_PRIORITIES,
  DEFAULT_CONTEXT_PRIORITY,
  isContextPriority,
  priorityWeight,
} from './context-priority.js';

export type { ContextSensitivity } from './context-sensitivity.js';
export {
  CONTEXT_SENSITIVITIES,
  DEFAULT_CONTEXT_SENSITIVITY,
  isContextSensitivity,
} from './context-sensitivity.js';

export type {
  ContextItemInput,
  ContextItemMetadata,
  ContextItemPatch,
  CopilotContextItem,
} from './context-item.js';

export type { ContextFilter, ContextRegistration, ContextRegistry } from './context-registry.js';
export { createContextRegistry } from './context-registry.js';

export type { ContextSerializer, ContextSerializerOptions, SerializedValue } from './context-serializer.js';
export { createDefaultContextSerializer } from './context-serializer.js';

export type { TokenEstimator } from './token-estimator.js';
export { createDefaultTokenEstimator } from './token-estimator.js';

export type { CompressibleText, ContextCompressor } from './context-compressor.js';
export { createTruncatingCompressor } from './context-compressor.js';

export { formatContextItemBlock, joinContextBlocks } from './context-format.js';

export type {
  ContextDiagnostics,
  ContextExclusion,
  ContextExclusionReason,
  ContextInspection,
  ResolvedContext,
  ResolvedContextItem,
} from './resolved-context.js';

export type { ContextEngine, ContextEngineOptions } from './context-engine.js';
export { createContextEngine } from './context-engine.js';

export type {
  CopilotStateDefinition,
  CopilotStateStore,
  StateScope,
  StateValidationResult,
  StateValidator,
} from './state-store.js';
export { createCopilotStateStore } from './state-store.js';

export type {
  StatePatch,
  StatePatchOp,
  StatePatchRejectionReason,
  StatePatchResult,
} from './state-patch.js';
