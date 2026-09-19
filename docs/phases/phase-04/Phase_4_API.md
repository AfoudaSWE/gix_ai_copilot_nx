# Phase 4 Public API

## `@gixcopilot/context`

All imports use the package's root entry (`src/index.ts`); no deep imports into `src/` are
supported (the package's `exports` field only exposes `.`).

### Scopes, priority, sensitivity

```ts
type ContextScope = 'global' | 'user' | 'application' | 'page' | 'component' | 'session' | 'temporary';
type ContextPriority = 'critical' | 'high' | 'normal' | 'low';
type ContextSensitivity = 'public' | 'internal' | 'sensitive' | 'restricted';
```

Plus `CONTEXT_SCOPES`/`CONTEXT_PRIORITIES`/`CONTEXT_SENSITIVITIES` (readonly arrays) and
`isContextScope`/`isContextPriority`/`isContextSensitivity` type guards, and
`DEFAULT_CONTEXT_PRIORITY` (`'normal'`) / `DEFAULT_CONTEXT_SENSITIVITY` (`'internal'`).

### Context items and registry

```ts
interface CopilotContextItem<T = unknown> {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly scope: ContextScope;
  readonly value: T;
  readonly priority: ContextPriority;
  readonly sensitivity: ContextSensitivity;
  readonly enabled: boolean;
  readonly owner?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

interface ContextItemInput<T = unknown> {
  readonly id?: string; readonly name: string; readonly description?: string;
  readonly scope: ContextScope; readonly value: T; readonly priority?: ContextPriority;
  readonly sensitivity?: ContextSensitivity; readonly enabled?: boolean;
  readonly owner?: string; readonly metadata?: Readonly<Record<string, unknown>>;
}

interface ContextRegistration<T = unknown> {
  readonly id: string;
  update(value: T): void;
  patch(next: Partial<Omit<ContextItemInput<T>, 'id'>>): void;
  dispose(): void; // idempotent
}

interface ContextFilter { readonly scope?: ContextScope | readonly ContextScope[]; readonly enabledOnly?: boolean; }

interface ContextRegistry {
  register<T>(input: ContextItemInput<T>): ContextRegistration<T>;
  update<T>(id: string, value: T): void;
  patch<T>(id: string, next: Partial<Omit<ContextItemInput<T>, 'id'>>): void;
  remove(id: string): void;
  get(id: string): CopilotContextItem | undefined;
  list(filter?: ContextFilter): readonly CopilotContextItem[];
  subscribe(listener: () => void): () => void;
  clear(): void;
}

function createContextRegistry(): ContextRegistry;
```

Identity/dedup rule: an explicit `id` is an update-in-place key; an omitted `id` always
creates a new item, even for a repeated `name`. A blank `name` throws `CopilotError`
(`VALIDATION_ERROR`).

### Serialization

```ts
interface ContextSerializerOptions { readonly maxStringLength?: number; readonly maxArrayLength?: number; readonly maxDepth?: number; }
interface SerializedValue { readonly text: string; readonly truncated: boolean; readonly warnings: readonly string[]; }
interface ContextSerializer { serialize(value: unknown): SerializedValue; }
function createDefaultContextSerializer(options?: ContextSerializerOptions): ContextSerializer;
```

### Token estimation and compression

```ts
interface TokenEstimator { estimate(text: string): number; }
function createDefaultTokenEstimator(): TokenEstimator;

interface CompressibleText { readonly text: string; readonly estimatedTokens: number; }
interface ContextCompressor { compress(input: CompressibleText, budgetTokens: number): Promise<CompressibleText> | CompressibleText; }
function createTruncatingCompressor(estimator?: TokenEstimator): ContextCompressor;
```

### Formatting

```ts
function formatContextItemBlock(name: string, scope: ContextScope, description: string | undefined, serializedText: string): string;
function joinContextBlocks(blocks: readonly string[]): string;
```

### Resolution result

```ts
type ContextExclusionReason = 'disabled' | 'budget' | 'duplicate' | 'invalid' | 'sensitivity-policy' | 'serialization-failure';
interface ContextExclusion { readonly id: string; readonly name: string; readonly scope: ContextScope; readonly reason: ContextExclusionReason; readonly detail?: string; }
interface ResolvedContextItem { readonly id: string; readonly name: string; readonly description?: string; readonly scope: ContextScope; readonly priority: ContextPriority; readonly sensitivity: ContextSensitivity; readonly estimatedTokens: number; readonly truncated: boolean; readonly text: string; }
interface ContextDiagnostics { readonly itemsRegistered: number; readonly itemsIncluded: number; readonly itemsExcluded: number; readonly resolutionMs: number; }
interface ResolvedContext { readonly items: readonly ResolvedContextItem[]; readonly content: string; readonly estimatedTokens: number; readonly excluded: readonly ContextExclusion[]; readonly diagnostics: ContextDiagnostics; }
interface ContextInspection { readonly estimatedTokens: number; readonly included: readonly {...}[]; readonly excluded: readonly {...}[]; readonly diagnostics: ContextDiagnostics; }
```

### Engine

```ts
interface ContextEngineOptions {
  readonly maxContextTokens?: number; // default 8000
  readonly estimator?: TokenEstimator;
  readonly serializer?: ContextSerializer;
  readonly compressor?: ContextCompressor;
  readonly sensitivityPolicy?: (item: CopilotContextItem) => boolean; // default: excludes 'restricted'
}
interface ContextEngine {
  resolve(registry: ContextRegistry): Promise<ResolvedContext>;
  inspect(registry: ContextRegistry): Promise<ContextInspection>;
}
function createContextEngine(options?: ContextEngineOptions): ContextEngine;
```

### Shared state

```ts
type StateScope = 'global' | 'session' | 'component';
interface StateValidationResult { readonly valid: boolean; readonly error?: string; }
type StateValidator<T> = (value: T) => boolean | StateValidationResult;
interface CopilotStateDefinition<T> { readonly id: string; readonly name: string; readonly initialValue: T; readonly scope?: StateScope; readonly validate?: StateValidator<T>; }
interface CopilotStateStore {
  register<T>(definition: CopilotStateDefinition<T>): T; // idempotent - seeds only if new
  has(id: string): boolean;
  get<T>(id: string): T | undefined;
  set<T>(id: string, value: T): void;      // throws CopilotError on validation failure
  update<T>(id: string, updater: (previous: T) => T): void;
  subscribe<T>(id: string, listener: (value: T) => void): () => void;
  remove(id: string): void;
  list(): readonly string[];
}
function createCopilotStateStore(): CopilotStateStore;
```

## `@gixcopilot/react` additions

```ts
interface UseCopilotContextOptions<T> {
  readonly id?: string; readonly name: string; readonly description?: string;
  readonly scope?: ContextScope; readonly value: T; readonly priority?: ContextPriority;
  readonly sensitivity?: ContextSensitivity; readonly enabled?: boolean;
  readonly metadata?: Readonly<Record<string, unknown>>;
}
function useCopilotContext<T>(options: UseCopilotContextOptions<T>): void;

interface CopilotContextDebug { resolve(): Promise<ResolvedContext>; inspect(): Promise<ContextInspection>; }
function useCopilotContextDebug(): CopilotContextDebug;

type ExposeStateToModel = boolean | { readonly description?: string; readonly priority?: ContextPriority; readonly sensitivity?: ContextSensitivity; };
interface UseCopilotStateOptions<T> {
  readonly id?: string; readonly name: string; readonly initialValue: T;
  readonly scope?: StateScope; readonly validate?: StateValidator<T>;
  readonly value?: T; readonly onChange?: (value: T) => void;
  readonly exposeToModel?: ExposeStateToModel;
}
function useCopilotState<T>(options: UseCopilotStateOptions<T>): readonly [T, (next: T | ((previous: T) => T)) => void];
```

`@gixcopilot/react` re-exports `ContextScope`, `ContextPriority`, `ContextSensitivity`,
`ContextExclusionReason`, `ContextInspection`, `ResolvedContext`, `StateScope`,
`StateValidator`, `StateValidationResult` from `@gixcopilot/context`, so a typical consumer
never needs `@gixcopilot/context` as a direct dependency.

`CopilotProviderProps` gained one optional field:

```ts
interface CopilotContextOptions { readonly maxContextTokens?: number; }
// CopilotProviderProps: ...(unchanged Phase 3 fields), readonly context?: CopilotContextOptions;
```

## Usage examples

```tsx
function ApplicationDetails({ application }: { application: Application }) {
  useCopilotContext({
    id: 'selected-application',
    name: 'selectedApplication',
    description: 'Application currently being viewed by the user',
    scope: 'page',
    priority: 'high',
    value: { id: application.id, status: application.status, applicantName: application.applicantName },
  });
  return <ApplicationView application={application} />;
}

function Filters() {
  const [filters, setFilters] = useCopilotState({
    id: 'application-filters',
    name: 'applicationFilters',
    initialValue: { status: 'all', country: null },
    exposeToModel: { description: 'Current application filters', priority: 'normal' },
  });
  return <StatusSelect value={filters.status} onChange={(status) => setFilters({ ...filters, status })} />;
}
```
