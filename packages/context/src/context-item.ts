import type { ContextPriority } from './context-priority.js';
import type { ContextScope } from './context-scope.js';
import type { ContextSensitivity } from './context-sensitivity.js';

/** Free-form, serializable metadata a caller can attach for debugging (Section 34). */
export type ContextItemMetadata = Readonly<Record<string, unknown>>;

/**
 * A framework-independent, transport-ready context item (Section 7). `value` is arbitrary
 * application data at registration time; it only becomes model-facing text after passing
 * through the engine's serializer (`context-serializer.ts`) - registering an item never
 * hands a raw object to a model.
 */
export interface CopilotContextItem<T = unknown> {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly scope: ContextScope;
  readonly value: T;
  readonly priority: ContextPriority;
  readonly sensitivity: ContextSensitivity;
  /** Disabled items are stored but never reach `ContextEngine.resolve()` (Section 31). */
  readonly enabled: boolean;
  /** Free-form origin label (e.g. `'react-component'`) - never a framework object (Section 39). */
  readonly owner?: string;
  readonly metadata?: ContextItemMetadata;
}

/**
 * What a caller passes to `ContextRegistry.register()`. `id` is optional - see
 * `context-registry.ts` for the identity/deduplication rule (Section 18) it triggers.
 */
export interface ContextItemInput<T = unknown> {
  readonly id?: string;
  readonly name: string;
  readonly description?: string;
  readonly scope: ContextScope;
  readonly value: T;
  readonly priority?: ContextPriority;
  readonly sensitivity?: ContextSensitivity;
  readonly enabled?: boolean;
  readonly owner?: string;
  readonly metadata?: ContextItemMetadata;
}

/** A partial update applied in place by `ContextRegistration.update()` (Section 17, 38). */
export type ContextItemPatch<T = unknown> = Partial<Omit<ContextItemInput<T>, 'id'>>;
