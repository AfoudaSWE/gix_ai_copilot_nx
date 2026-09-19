# Phase 6 Public API

## `@gixcopilot/generative-ui`

```ts
interface GenerativeComponentMetadata {
  readonly category?: string; readonly tags?: readonly string[];
  readonly interactive?: boolean; readonly supportsStreaming?: boolean;
  readonly supportsState?: boolean; readonly version?: string;
  readonly custom?: Readonly<Record<string, unknown>>;
}
interface GenerativeComponentDefinition<TProps = unknown> {
  readonly name: string; readonly description: string;
  readonly propsSchema: z.ZodType<TProps>; readonly metadata?: GenerativeComponentMetadata;
}
type AnyGenerativeComponentDefinition = GenerativeComponentDefinition<unknown>;

interface GenerativeComponentRegistration {
  readonly name: string;
  update(next: AnyGenerativeComponentDefinition): void;
  dispose(): void; // idempotent
}
interface GenerativeComponentRegisterOptions { readonly replace?: boolean; }
interface GenerativeComponentListFilter {
  readonly enabledOnly?: boolean; readonly category?: string; readonly tags?: readonly string[];
}
interface GenerativeComponentRegistry {
  register(component: AnyGenerativeComponentDefinition, options?: GenerativeComponentRegisterOptions): GenerativeComponentRegistration;
  unregister(name: string): void;
  has(name: string): boolean;
  get(name: string): AnyGenerativeComponentDefinition | undefined;
  list(filter?: GenerativeComponentListFilter): readonly AnyGenerativeComponentDefinition[];
  subscribe(listener: () => void): () => void;
  clear(): void;
}
function createGenerativeComponentRegistry(): GenerativeComponentRegistry;

const GENERATIVE_UI_TOOL_NAMESPACE: 'ui.render';
function generativeUiToolName(componentName: string): string;
function isGenerativeUiToolName(toolName: string): boolean;
function generativeUiComponentNameOfToolName(
  toolName: string,
  registry: { readonly list: () => readonly AnyGenerativeComponentDefinition[] },
): string | undefined;
interface GenerativeUiRenderResult { readonly component: string; readonly props: unknown; }
function toGenerativeUiToolDefinition(
  component: AnyGenerativeComponentDefinition,
): ToolDefinition<unknown, GenerativeUiRenderResult>;

const STATE_PATCH_TOOL_NAMESPACE: 'state.patch';
function statePatchToolName(stateId: string): string;
function isStatePatchToolName(toolName: string): boolean;
type StatePatchToolOutput = // matches @gixcopilot/context's StatePatchResult exactly
  | { status: 'applied'; revision: number; value: unknown }
  | { status: 'conflict'; currentRevision: number }
  | { status: 'rejected'; reason: 'unknown-state' | 'not-writable' | 'invalid-value' | 'invalid-patch'; detail?: string };
function toStatePatchToolDefinition(
  stateStore: CopilotStateStore,
  stateId: string,
  options: { readonly name: string; readonly description: string },
): ToolDefinition<{ op: 'set' | 'merge'; value: unknown; baseRevision: number }, StatePatchToolOutput>;

type ProgressStepStatus = 'pending' | 'running' | 'completed' | 'failed';
interface ProgressStep { readonly id: string; readonly label: string; readonly status: ProgressStepStatus; }
interface ToolActivityLike { readonly id: string; readonly name: string; readonly status: 'requested' | 'running' | 'succeeded' | 'failed'; }
interface ToProgressStepsOptions { readonly labelOf?: (activity: ToolActivityLike) => string; }
function toProgressSteps(activity: readonly ToolActivityLike[], options?: ToProgressStepsOptions): readonly ProgressStep[];
```

## `@gixcopilot/context` additions

```ts
type StatePatchOp = 'set' | 'merge';
interface StatePatch { readonly op: StatePatchOp; readonly value: unknown; }
type StatePatchRejectionReason = 'unknown-state' | 'not-writable' | 'invalid-value' | 'invalid-patch';
type StatePatchResult =
  | { readonly status: 'applied'; readonly revision: number; readonly value: unknown }
  | { readonly status: 'conflict'; readonly currentRevision: number }
  | { readonly status: 'rejected'; readonly reason: StatePatchRejectionReason; readonly detail?: string };

interface CopilotStateDefinition<T> {
  // ...unchanged Phase 4 fields...
  readonly modelWritable?: boolean; // NEW, default false
}
interface CopilotStateStore {
  // ...unchanged Phase 4 members...
  getRevision(id: string): number | undefined;             // NEW
  isModelWritable(id: string): boolean;                     // NEW
  applyPatch(id: string, patch: StatePatch, baseRevision: number): StatePatchResult; // NEW
}
```

## `@gixcopilot/react` additions

```ts
interface UseGenerativeComponentOptions<TProps> {
  readonly name: string; readonly description: string;
  readonly props: z.ZodType<TProps>; readonly component: ComponentType<TProps>;
  readonly metadata?: GenerativeComponentMetadata;
  readonly enabled?: boolean | (() => boolean);
}
function useGenerativeComponent<TProps>(options: UseGenerativeComponentOptions<TProps>): void;

interface ToolRenderState {
  readonly status: 'requested' | 'running' | 'succeeded' | 'failed';
  readonly arguments: Readonly<Record<string, unknown>>;
  readonly result?: unknown; readonly error?: PublicCopilotError;
}
type ToolRenderFn = (state: ToolRenderState) => ReactNode;
interface UseToolRendererOptions { readonly tool: string; readonly render: ToolRenderFn; }
function useToolRenderer(options: UseToolRendererOptions): void;

function useResolveToolRenderer(): (toolCall: ToolCallState) => ReactNode | undefined;

interface GenerativeUIRequestState {
  readonly id: string; readonly component: string;
  readonly status: 'requested' | 'running' | 'succeeded' | 'failed';
  readonly props?: unknown; readonly error?: PublicCopilotError;
}
function useGenerativeUIRequests(): readonly GenerativeUIRequestState[];

function useInvokeTool(): (name: string, args: unknown) => Promise<ToolResult>;
```

`UseCopilotStateOptions<T>` gained one field:

```ts
interface UseCopilotStateOptions<T> {
  // ...unchanged Phase 4 fields (id, name, initialValue, scope, validate, value, onChange,
  // exposeToModel)...
  readonly modelWritable?: boolean; // NEW, default false
}
```

Re-exported (so a consumer never needs a direct `@gixcopilot/generative-ui`/
`@gixcopilot/context` dependency just to type these calls): `GenerativeComponentMetadata`
(from `@gixcopilot/generative-ui`), `StatePatchResult` (from `@gixcopilot/context`).

## `@gixcopilot/ui` additions

```ts
interface ToolActivityProps {
  readonly toolCalls: readonly ToolCallState[];
  readonly labels: CopilotLabels;
  readonly resolveRenderer?: (toolCall: ToolCallState) => ReactNode | undefined; // NEW
  readonly onRenderError?: CopilotChatProps['onRenderError'];                    // NEW
}
```

No new exported components — `ToolActivity`'s existing default rendering now additionally
consults `resolveRenderer` when `CopilotChat` supplies one (always, automatically); a host
overriding `components.ToolActivity` entirely can ignore the new props or wire them up
itself.

## Usage examples

```tsx
const ApplicationCardSchema = z.object({
  applicationId: z.string(),
  applicantName: z.string(),
  status: z.string(),
});

function ApplicationCard({ applicationId, applicantName, status }: z.infer<typeof ApplicationCardSchema>) {
  const invoke = useInvokeTool();
  return (
    <div>
      <strong>{applicationId}</strong> - {applicantName} ({status})
      <button onClick={() => invoke('navigation.openApplication', { applicationId })}>Open</button>
    </div>
  );
}

useGenerativeComponent({
  name: 'ApplicationCard',
  description: 'Displays an application summary',
  props: ApplicationCardSchema,
  component: ApplicationCard,
});
```

```tsx
useToolRenderer({
  tool: 'applications.getStatus',
  render({ status, result }) {
    if (status === 'running') return <ApplicationSkeleton />;
    if (status === 'succeeded') return <StatusBadge {...(result as { status: string })} />;
    return <ApplicationError />;
  },
});
```

```tsx
const [filters, setFilters] = useCopilotState({
  id: 'applicationFilters',
  initialValue: { status: 'all' },
  exposeToModel: { description: 'Current application filters' },
  modelWritable: true,
});
// A valid AI-proposed patch updates `filters` through the same store `setFilters` writes to;
// a stale/invalid one is rejected before it ever reaches the store.
```
