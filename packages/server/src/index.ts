export { createServer } from './app.js';
export type { AdmissionDecision, CreateServerOptions, RunAdmission, RunInfo, RunObserver } from './app.js';

// Lower-level building blocks `createServer` composes internally (Section 8's "avoid public
// API explosion" still applies, but these are real, independently tested primitives - the same
// pattern as `createRunRegistry`/`formatSseFrame` below - useful for advanced composition such
// as running the Model -> Tool -> Model loop in-process without a full HTTP/SSE round trip).
export { createToolCallingExecutor } from './tool-calling-executor.js';
export type { CreateToolCallingExecutorOptions } from './tool-calling-executor.js';
export { createFrontendToolBridge } from './frontend-tool-bridge.js';
export type { AwaitFrontendResultOptions, FrontendToolBridge } from './frontend-tool-bridge.js';

export { createRunRegistry } from './run-registry.js';
export type { RunRegistry } from './run-registry.js';

export { formatSseComment, formatSseFrame, SSE_RESPONSE_HEADERS } from './sse.js';

export { cancelRunParamsSchema, createRunRequestSchema } from './schemas.js';
export type { CreateRunRequestBody } from './schemas.js';

// Phase 12 - operational endpoints (readiness, metrics); liveness is `/health` above.
export { createMetricsRegistry, createRunMetricsObserver, registerOperationalRoutes } from './operations.js';
export type { MetricsRegistry, OperationalRoutesOptions, ReadinessCheck } from './operations.js';
