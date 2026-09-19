# Phase 5 Public API

## `@gixcopilot/tools` (new package)

All imports use the package's root entry (`src/index.ts`).

### Tool identity

```ts
function isValidToolName(name: string): boolean;
function assertValidToolName(name: string): void;       // throws CopilotError.validation
function toolNamespaceOf(name: string): string | undefined;
```

### Metadata

```ts
type ToolConcurrency = 'parallel-safe' | 'serial' | 'exclusive';
type ToolRiskClass = 'read-only' | 'reversible' | 'compensatable' | 'irreversible';

interface ToolMetadata {
  readonly category?: string;
  readonly tags?: readonly string[];
  readonly source?: ToolSource;                         // from @gixcopilot/protocol
  readonly executionLocation?: ToolExecutionLocation;    // from @gixcopilot/protocol
  readonly readOnly?: boolean;
  readonly destructive?: boolean;
  readonly idempotent?: boolean;
  readonly riskClass?: ToolRiskClass;
  readonly timeoutMs?: number;
  readonly concurrency?: ToolConcurrency;
  readonly sensitivity?: string;
  readonly custom?: Readonly<Record<string, unknown>>;
}
```

### Tool definition

```ts
interface ToolExecutionContext {
  readonly runId: RunId;
  readonly threadId?: ThreadId;
  readonly signal: AbortSignal;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

interface ToolDefinition<TInput = unknown, TOutput = unknown> {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: z.ZodType<TInput>;
  readonly outputSchema?: z.ZodType<TOutput>;
  execute(input: TInput, context: ToolExecutionContext): Promise<TOutput>;
  readonly metadata?: ToolMetadata;
  readonly enabled?: boolean | (() => boolean);
}

type AnyToolDefinition = ToolDefinition<unknown, unknown>;
function isToolEnabled(tool: AnyToolDefinition): boolean;
```

### `defineTool()`

```ts
function defineTool<TInputSchema extends z.ZodType, TOutputSchema extends z.ZodType | undefined = undefined>(
  options: {
    name: string;
    description: string;
    input: TInputSchema;
    output?: TOutputSchema;
    execute(input: z.infer<TInputSchema>, context: ToolExecutionContext):
      Promise<TOutputSchema extends z.ZodType ? z.infer<TOutputSchema> : unknown>;
    metadata?: ToolMetadata;
    enabled?: boolean | (() => boolean);
  },
): ToolDefinition<z.infer<TInputSchema>, TOutputSchema extends z.ZodType ? z.infer<TOutputSchema> : unknown>;
```

### Registry

```ts
interface ToolRegistration {
  readonly name: string;
  update(next: AnyToolDefinition): void;
  dispose(): void;                                       // idempotent
}
interface ToolRegisterOptions { readonly replace?: boolean; }
interface ToolListFilter {
  readonly enabledOnly?: boolean;
  readonly category?: string;
  readonly tags?: readonly string[];
  readonly source?: ToolSource;
}
interface ToolRegistry {
  register(tool: AnyToolDefinition, options?: ToolRegisterOptions): ToolRegistration;
  unregister(name: string): void;
  has(name: string): boolean;
  get(name: string): AnyToolDefinition | undefined;
  list(filter?: ToolListFilter): readonly AnyToolDefinition[];
  subscribe(listener: () => void): () => void;
  clear(): void;
}
function createToolRegistry(): ToolRegistry;
```

### Resolver

```ts
interface ToolResolutionContext { readonly runId: RunId; readonly threadId?: ThreadId; }
interface ToolResolver { resolve(context: ToolResolutionContext): Promise<readonly AnyToolDefinition[]>; }

function createDefaultToolResolver(registry: ToolRegistry): ToolResolver;
function createStaticToolResolver(tools: readonly AnyToolDefinition[]): ToolResolver;
function combineToolResolvers(...resolvers: readonly ToolResolver[]): ToolResolver;
```

### Manifest / schema

```ts
function toToolManifestEntry(tool: AnyToolDefinition): ToolManifestEntry;    // from @gixcopilot/protocol
function toToolManifest(tools: readonly AnyToolDefinition[]): readonly ToolManifestEntry[];
```

### Result serialization

```ts
interface SerializeToolResultOptions { readonly maxResultBytes?: number; }   // default 32 KiB
function serializeToolResult(data: unknown, options?: SerializeToolResultOptions):
  { readonly value: unknown; readonly truncated: boolean };
```

### Concurrency

```ts
function planConcurrency(concurrencies: readonly (ToolConcurrency | undefined)[]): 'parallel' | 'sequential';
function runWithConcurrencyPlan<TItem, TResult>(
  items: readonly TItem[],
  concurrencyOf: (item: TItem) => ToolConcurrency | undefined,
  run: (item: TItem) => Promise<TResult>,
): Promise<readonly TResult[]>;
```

### Runtime

```ts
interface ToolInvocationRequest {
  readonly toolCallId: ToolCallId;
  readonly name: string;
  readonly arguments: unknown;
  readonly context: ToolExecutionContext;
}
type ToolRuntimeMiddleware = (
  invocation: ToolInvocationRequest,
  next: () => Promise<ToolResult>,       // ToolResult from @gixcopilot/protocol
) => Promise<ToolResult>;

interface CreateToolRuntimeOptions {
  readonly resolver: ToolResolver;
  readonly middleware?: readonly ToolRuntimeMiddleware[];
  readonly defaultTimeoutMs?: number;
  readonly resultSerialization?: SerializeToolResultOptions;
  readonly onEvent?: (event:
    | { readonly phase: 'started'; readonly toolCallId: ToolCallId; readonly name: string }
    | { readonly phase: 'completed'; readonly toolCallId: ToolCallId; readonly name: string; readonly result: unknown }
    | { readonly phase: 'failed'; readonly toolCallId: ToolCallId; readonly name: string; readonly error: PublicCopilotError },
  ) => void;
}
interface ToolRuntime { execute(request: ToolInvocationRequest): Promise<ToolResult>; }
function createToolRuntime(options: CreateToolRuntimeOptions): ToolRuntime;
```

### Mock tools

```ts
const mathAddTool: ToolDefinition<{ a: number; b: number }, { result: number }>;
const applicationsGetStatusTool: ToolDefinition<{ applicationId: string }, { applicationId: string; status: string }>;
```

## `@gixcopilot/protocol` additions

```ts
type ToolSource = 'native' | 'frontend' | 'openapi' | 'mcp' | 'agent';
type ToolExecutionLocation = 'server' | 'client';
type ToolCallId = string;
function createToolCallId(): ToolCallId;

interface ToolCall { readonly id: ToolCallId; readonly name: string; readonly arguments: Readonly<Record<string, unknown>>; }
type ToolResult =
  | { readonly status: 'success'; readonly toolCallId: ToolCallId; readonly data: unknown }
  | { readonly status: 'error'; readonly toolCallId: ToolCallId; readonly error: PublicCopilotError };
type ToolLifecycleEvent = /* phase: 'requested' | 'started' | 'completed' | 'failed' */ /* see Architecture */;
interface ToolManifestEntry {
  readonly name: string; readonly description: string;
  readonly parameters: Readonly<Record<string, unknown>>;
  readonly executionLocation: ToolExecutionLocation;
}

// ContentPart additions (Message role 'tool' already existed):
type ContentPart =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'tool_call'; readonly toolCallId: ToolCallId; readonly name: string; readonly arguments: Readonly<Record<string, unknown>> }
  | { readonly type: 'tool_result'; readonly toolCallId: ToolCallId; readonly result: ToolResult };

// FinishReason addition:
type FinishReason = 'stop' | 'length' | 'content_filter' | 'cancelled' | 'error' | 'unknown' | 'tool_calls';

// CopilotErrorCode additions + CopilotError static factories:
// TOOL_NOT_FOUND, TOOL_DISABLED, TOOL_EXECUTION_ERROR, TOOL_OUTPUT_INVALID,
// TOOL_ITERATION_LIMIT_EXCEEDED, FRONTEND_TOOL_UNAVAILABLE
CopilotError.toolNotFound(name): CopilotError;
CopilotError.toolDisabled(name): CopilotError;
CopilotError.toolExecutionError(message, metadata?): CopilotError;
CopilotError.toolOutputInvalid(message, metadata?): CopilotError;
CopilotError.toolIterationLimitExceeded(limit): CopilotError;
CopilotError.frontendToolUnavailable(name): CopilotError;

// CopilotEvent additions:
interface ToolCallRequestedEvent extends CopilotEventBase {
  readonly type: 'tool.requested'; readonly toolCallId: ToolCallId; readonly name: string;
  readonly arguments: Readonly<Record<string, unknown>>; readonly source: ToolSource;
}
interface ToolCallStartedEvent extends CopilotEventBase {
  readonly type: 'tool.started'; readonly toolCallId: ToolCallId; readonly name: string;
}
interface ToolCallCompletedEvent extends CopilotEventBase {
  readonly type: 'tool.completed'; readonly toolCallId: ToolCallId; readonly name: string; readonly result: unknown;
}
interface ToolCallFailedEvent extends CopilotEventBase {
  readonly type: 'tool.failed'; readonly toolCallId: ToolCallId; readonly name: string; readonly error: PublicCopilotError;
}
```

## `@gixcopilot/core` additions

```ts
interface ExecutorContext {
  readonly runId: RunId;
  readonly signal: AbortSignal;
  readonly onToolEvent?: (event: ToolLifecycleEvent) => void;   // NEW, optional
}
// Executor.execute()'s signature is otherwise unchanged.
```

## `@gixcopilot/provider` (provider-core) additions

```ts
interface ModelToolDefinition { readonly name: string; readonly description: string; readonly parameters: Readonly<Record<string, unknown>>; }
interface ModelRequest { /* ...unchanged fields... */ readonly tools?: readonly ModelToolDefinition[]; }
interface ModelExecutionRequest { /* ...unchanged fields... */ readonly tools?: readonly ModelToolDefinition[]; }
interface ModelToolCall { readonly id: string; readonly name: string; readonly arguments: Readonly<Record<string, unknown>>; }
type ModelStreamEvent = /* ...unchanged variants... */ | { readonly type: 'tool_call.requested'; readonly toolCall: ModelToolCall };

interface ToolCallDeltaFragment {
  readonly index: number; readonly id?: string; readonly name?: string; readonly argumentsDelta?: string;
}
class ToolCallAssembler {
  push(fragment: ToolCallDeltaFragment): void;
  finalize(): readonly ModelToolCall[];
  readonly isEmpty: boolean;
}

interface GenerateObjectOptions<TSchema extends z.ZodType> {
  readonly runtime: ModelRuntime; readonly model?: ModelReference;
  readonly messages: readonly ModelMessage[]; readonly schema: TSchema;
  readonly temperature?: number; readonly timeoutMs?: number; readonly signal?: AbortSignal;
}
function generateObject<TSchema extends z.ZodType>(options: GenerateObjectOptions<TSchema>):
  Promise<{ readonly object: z.infer<TSchema> }>;
```

## `@gixcopilot/provider-mock` additions

```ts
interface MockProviderScenario {
  /* ...unchanged fields... */
  readonly toolCalls?: readonly ModelToolCall[];   // scripts a deterministic tool-calling turn
}
```

## `@gixcopilot/server` additions

```ts
interface ToolRuntimeDefaults {
  readonly defaultTimeoutMs?: number;
  readonly maxToolIterations?: number;             // default 8
  readonly frontendToolTimeoutMs?: number;
}
interface CreateServerOptions {
  /* ...unchanged fields... */
  readonly toolRegistry?: ToolRegistry;
  readonly toolRuntimeDefaults?: ToolRuntimeDefaults;
}
// New route: POST /runs/:runId/tool-results  { toolCallId, result: ToolResult }
```

`createToolCallingExecutor` and `createFrontendToolBridge` are internal to
`@gixcopilot/server` (not part of its public `index.ts` export surface) — a server app author
configures tool support entirely through `CreateServerOptions`.

## `@gixcopilot/client` additions

```ts
interface RunOptions { /* ...unchanged fields... */ readonly tools?: readonly ToolManifestEntry[]; }
interface CopilotClient {
  run(options: RunOptions): ClientRun;
  submitToolResult(runId: string, toolCallId: string, result: ToolResult): Promise<void>;   // NEW
}
interface CopilotTransport {
  run(request: TransportRunRequest): AsyncIterable<CopilotEvent>;
  cancel(runId: string): Promise<void>;
  submitToolResult(runId: string, toolCallId: string, result: ToolResult): Promise<void>;   // NEW
}
```

## `@gixcopilot/react` additions

```ts
interface UseFrontendToolOptions<TInputSchema extends z.ZodType, TOutputSchema extends z.ZodType | undefined = undefined> {
  readonly name: string; readonly description: string;
  readonly input: TInputSchema; readonly output?: TOutputSchema;
  readonly execute: (input: z.infer<TInputSchema>, context: ToolExecutionContext) =>
    Promise<TOutputSchema extends z.ZodType ? z.infer<TOutputSchema> : unknown>;
  readonly metadata?: Omit<ToolMetadata, 'source' | 'executionLocation'>;
  readonly enabled?: boolean | (() => boolean);
}
function useFrontendTool<TInputSchema extends z.ZodType, TOutputSchema extends z.ZodType | undefined = undefined>(
  options: UseFrontendToolOptions<TInputSchema, TOutputSchema>,
): void;

interface ToolCallState {
  readonly id: ToolCallId; readonly name: string; readonly source: ToolSource;
  readonly status: 'requested' | 'running' | 'succeeded' | 'failed';
  readonly arguments: Readonly<Record<string, unknown>>;
  readonly result?: unknown; readonly error?: PublicCopilotError;
}
function useToolCalls(): readonly ToolCallState[];

// ChatSnapshot gained: readonly toolCalls: readonly ToolCallState[];
```

Also re-exported (so a consumer never needs a direct `@gixcopilot/tools`/`@gixcopilot/protocol`
dependency just to type these calls): `ToolExecutionContext`, `ToolMetadata` (from
`@gixcopilot/tools`), `ToolResult`, `ToolSource` (from `@gixcopilot/protocol`).

## `@gixcopilot/ui` additions

```ts
interface ToolActivityProps { readonly toolCalls: readonly ToolCallState[]; readonly labels: CopilotLabels; }
function ToolActivity(props: ToolActivityProps): ReactElement | null;

interface CopilotComponents { /* ...unchanged slots... */ readonly ToolActivity?: ComponentType<ToolActivityProps>; }

interface CopilotLabels { /* ...unchanged fields... */ readonly toolRunning: string; readonly toolCompleted: string; readonly toolFailed: string; }
```
