# Phase 11 public API

Only implemented exports are listed (Section 216).

## `@gixcopilot/telemetry`

| Area | Exports |
| --- | --- |
| Adapters | `createNoopTelemetry`, `composeTelemetry`, `createOpenTelemetryAdapter`, `createRecordingTelemetry`; types `TelemetryAdapter`, `SpanHandle`, `StartSpanOptions`, `MetricRecord`, `RecordingTelemetry`, `TelemetrySession` |
| Conventions | `SPAN_NAMES`, `ATTR`, `correlationAttributes`, `compactAttributes`; type `Correlation` |
| Diagnostics | `DIAGNOSTIC_VERSION`, `diagnostic`; `DiagnosticEvent` union and each diagnostic type |
| Redaction | `DEFAULT_TELEMETRY_MODE` (`redacted`), `REDACTED`, `createRedactionPolicy`, `maskSecretsInText`, `maskPiiInText`; type `TelemetryMode` |
| Sampling (new) | `createRatioSampler`, `alwaysSample`, `neverSample`; type `TraceSampler`; `shouldSample` option on the recording and OpenTelemetry adapters |
| Logs (new) | `recordLog(telemetry, level, message, { fields, correlation })` |
| Metrics, cost, usage | `METRICS`, `createMetricsCollector`, `summarizeHistogram`, `createCostEstimator`, `createStaticPricingTable`, `ZERO_USAGE`, `addUsage`, `sumUsage`, `aggregateRunTreeUsage` |
| Correlation plumbing | `TELEMETRY_METADATA_KEY`, `readTelemetryMetadata`, `withTelemetryMetadata`, `stripTelemetryMetadata` |
| Instrumentation | `instrumentModelRuntime`, `createModelRuntimeTelemetryListener`, `createToolTelemetry`, `createToolCallTracker`, `createFirewallTelemetry`, `deriveSecurityStages`, `instrumentApprovalStore`, `createRetrieverTelemetry`, `instrumentContextEngine`, `instrumentMemoryService`, `observeStateStore`, `recordProtocolEvent`, `recordRun` |

## `@gixcopilot/devtools`

| Area | Exports |
| --- | --- |
| Recorder | `createDevTools({ source })` returns `DevToolsRecorder` (`snapshot`, `getSession(viewer?)`, `getRun`, `subscribe(listener, viewer?)`, `exportBundle`, `clear`) |
| Projection | `projectSession(snapshot, viewer?)`, `isErrorEvent`; types `DevToolsSession`, `DevToolsViewer`, `DiagnosticsSnapshot` |
| Inspectors | `overview`, `findRun`, `runTree`, `conversation`, `contextInspections`, `stateIds`, `stateTimeline`, `reconstructState`, `TIME_TRAVEL_NOTICE`, `toolTimeline`, `firewallTimeline`, `securityDecisions`, `retrievals`, `citations`, `memoryTimeline`, `delegations`, `handoffs`, `routingDecisions`, `agentTree`, `workflows`, `workflow`, `traces`, `flattenTrace`, `errors`, `categorize`, `severity`, `eventLabel`, `filterEvents`, `paginate`, `generativeUiRequests` |
| Bundles | `exportBundle(snapshot, { mode })`, `importBundle(json)`, `stricterMode`; type `DebugBundle` |
| `@gixcopilot/devtools/server` | `createDevToolsPlugin(recorder, { enabled, authorize, allowUnauthenticated, resolveViewer, allowInProduction, basePath, exportMode })`, `formatDiagnosticFrame`. Routes: `GET {base}/session`, `/runs/:runId`, `/export`, `/stream` |

## `@gixcopilot/testing`

| Area | Exports |
| --- | --- |
| Model | `createTestModel(rules, { id, fallback, defaultUsage })`, `toolThenAnswer`; types `TestModel`, `TestModelRule`, `TestModelResponse` (`text`, `toolCalls`, `object`, `malformed`, `fail`, `interruptAfter`, `hang`), `TestModelTurn`, `SimulatedFailure` |
| Tools | `createToolMocks`, `mockTool`, `expectToolCalled`, `expectToolNotCalled`, `expectToolOrder` |
| Security | `createSecurityFixture`, `expectActionDenied`, `expectApprovalRequired`, `expectActionAllowed`, `expectToolUnavailable` |
| Knowledge | `createKnowledgeFixture({ documents })`, `expectSourceRetrieved`, `expectSourceNotRetrieved`, `expectCitation`, `expectAclApplied` |
| Memory | `createMemoryFixture({ records })`, `expectMemoryRetrieved`, `expectMemoryNotRetrieved`, `expectMemoryWritten`, `expectMemoryNotWritten`, `expectMemoryInaccessible` |
| Approvals | `createApprovalFixture({ clock })` |
| Simulation | `createAgentSimulation` (`run`, `routeAndRun`, `session`), `createWorkflowSimulation` (`engine`, `approvals`, `restart`), `createToolStack`, `createInstrumentedModelRuntime` |
| Harness | `createCopilotTestHarness({ model, tools, knowledge, memory, security })` |
| Replay | `createReplay(recording, { mode, runId, models, liveTools })`, `replayAgentRun`, `replayWorkflowRun`, `createRecordedRetriever`, `ReplayNotPossibleError` |
| Determinism | `createFakeClock`, `createSequentialIds`, `TestAssertionError` |

## `@gixcopilot/evals`

| Area | Exports |
| --- | --- |
| Datasets and records | `defineEvalDataset`, `buildExecutionRecord`, `deriveOutcome`; types `EvalDataset`, `EvalCase`, `EvalExpectations`, `ExecutionRecord`, `EvalOutcome`, `ReproducibilitySnapshot`, `HumanLabel` |
| Runner | `createEvalRunner({ target, evaluators, repetitions, telemetryMode, snapshot, costEstimator, caseTimeoutMs })`, `summarize`; types `EvalTarget`, `EvalRun`, `CaseResult`, `EvalRunSummary` |
| Evaluators | `defaultEvaluators`, `defineEvaluator`, `taskCompletionEvaluator`, `answerContentEvaluator`, `toolSelectionEvaluator`, `toolArgumentsEvaluator`, `forbiddenToolsEvaluator`, `permissionComplianceEvaluator`, `groundednessEvaluator`, `citationEvaluator`, `retrievalEvaluator`, `aclRetrievalEvaluator`, `structuredOutputEvaluator`, `contextEvaluator`, `memoryEvaluator`, `routingEvaluator`, `forbiddenAgentsEvaluator`, `delegationEvaluator`, `handoffEvaluator`, `plannerEvaluator`, `workflowEvaluator`, `generativeUiEvaluator`, `latencyEvaluator`, `tokenEvaluator`, `costEvaluator`, `errorRateEvaluator`, `createLlmJudgeEvaluator`; helpers `result`, `skipped`, `matchesSubset` |
| Comparison and gates | `compareEvalRuns`, `runExperiment`, `evaluateGates` |
| Reports and storage | `renderEvalReport`, `toEvalJson`, `createInMemoryEvalStore`, `createFileEvalStore` |
| From runs and labels | `createEvalCaseFromRun`, `withHumanLabels`, `summarizeHumanLabels`, `hashText` |

## Runtime additions (additive, no signature changes)

- `agent.run` span attributes: `copilot.agent.version`, `.visible_tools`, `.knowledge_sources`,
  `.memory_types`, `copilot.model.provider`, `copilot.model.name`, `copilot.agent.max_*`.
- `workflow.run` span attribute `copilot.workflow.steps`.
- Agent and workflow events are also recorded as `protocol.event` diagnostics when telemetry is
  enabled.

## Protocol changes

None.
