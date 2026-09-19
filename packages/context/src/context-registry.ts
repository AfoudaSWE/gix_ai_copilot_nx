import { CopilotError } from '@gixcopilot/protocol';
import { DEFAULT_CONTEXT_PRIORITY } from './context-priority.js';
import { DEFAULT_CONTEXT_SENSITIVITY } from './context-sensitivity.js';
import type { ContextScope } from './context-scope.js';
import type {
  ContextItemInput,
  ContextItemPatch,
  CopilotContextItem,
} from './context-item.js';

/**
 * A live handle returned by `register()` (Section 17). Prefer this over calling
 * `registry.update(id, ...)`/`registry.remove(id)` directly - it is what a React hook's
 * effect cleanup calls on unmount, and it fails loudly (not silently) once disposed.
 */
export interface ContextRegistration<T = unknown> {
  readonly id: string;
  /** Replace this item's value only, keeping every other field unchanged. */
  update(value: T): void;
  /** Merge a partial patch (value and/or metadata fields) into this item. */
  patch(next: ContextItemPatch<T>): void;
  /** Idempotent. Removes the item from the registry; safe to call more than once. */
  dispose(): void;
}

export interface ContextFilter {
  readonly scope?: ContextScope | readonly ContextScope[];
  /** Defaults to `false` - `list()` returns disabled items too unless this is `true`. */
  readonly enabledOnly?: boolean;
}

/**
 * The central, framework-independent context registry (Section 16). One registry is one
 * isolated universe of context items - a host application creates one per independent
 * Copilot instance (Section 65); nothing here requires a global singleton.
 */
export interface ContextRegistry {
  register<T>(input: ContextItemInput<T>): ContextRegistration<T>;
  update<T>(id: string, value: T): void;
  patch<T>(id: string, next: ContextItemPatch<T>): void;
  remove(id: string): void;
  get(id: string): CopilotContextItem | undefined;
  list(filter?: ContextFilter): readonly CopilotContextItem[];
  subscribe(listener: () => void): () => void;
  /** Removes every item. Primarily for provider teardown/tests. */
  clear(): void;
}

function matchesScope(item: CopilotContextItem, filter: ContextFilter | undefined): boolean {
  if (!filter?.scope) return true;
  const scopes = Array.isArray(filter.scope) ? filter.scope : [filter.scope];
  return (scopes as readonly ContextScope[]).includes(item.scope);
}

/**
 * Identity/deduplication rule (Section 18), chosen and documented deterministically: an
 * explicit `id` is an update-in-place key - registering the same `id` twice replaces the
 * existing item rather than creating a second one. Omitting `id` always creates a new item
 * with a generated id, even if `name` collides with an existing item - registration never
 * merges by name alone, which would be a fuzzy/implicit rule (Section 24 makes the same
 * choice for near-duplicate *values* found later, at resolve time).
 */
export function createContextRegistry(): ContextRegistry {
  const items = new Map<string, CopilotContextItem>();
  const listeners = new Set<() => void>();

  function notify(): void {
    for (const listener of listeners) listener();
  }

  function requireName(name: string): void {
    if (!name.trim()) {
      throw CopilotError.validation('A context item requires a non-empty name.');
    }
  }

  function store<T>(id: string, input: ContextItemInput<T>): CopilotContextItem<T> {
    requireName(input.name);
    const item: CopilotContextItem<T> = {
      id,
      name: input.name,
      description: input.description,
      scope: input.scope,
      value: input.value,
      priority: input.priority ?? DEFAULT_CONTEXT_PRIORITY,
      sensitivity: input.sensitivity ?? DEFAULT_CONTEXT_SENSITIVITY,
      enabled: input.enabled ?? true,
      owner: input.owner,
      metadata: input.metadata,
    };
    items.set(id, item);
    return item;
  }

  function registerInternal<T>(input: ContextItemInput<T>): ContextRegistration<T> {
    const id = input.id ?? crypto.randomUUID();
    store(id, input);
    notify();

    let disposed = false;
    return {
      id,
      update(value: T) {
        if (disposed) return;
        registryUpdate(id, value);
      },
      patch(next: ContextItemPatch<T>) {
        if (disposed) return;
        registryPatch(id, next);
      },
      dispose() {
        if (disposed) return;
        disposed = true;
        registryRemove(id);
      },
    };
  }

  function registryUpdate<T>(id: string, value: T): void {
    const existing = items.get(id);
    if (!existing) {
      throw CopilotError.validation('No context item registered with that id.', { id });
    }
    items.set(id, { ...existing, value });
    notify();
  }

  function registryPatch<T>(id: string, next: ContextItemPatch<T>): void {
    const existing = items.get(id);
    if (!existing) {
      throw CopilotError.validation('No context item registered with that id.', { id });
    }
    if (next.name !== undefined) requireName(next.name);
    items.set(id, {
      ...existing,
      ...(next.name !== undefined ? { name: next.name } : {}),
      ...(next.description !== undefined ? { description: next.description } : {}),
      ...(next.scope !== undefined ? { scope: next.scope } : {}),
      ...(next.value !== undefined ? { value: next.value } : {}),
      ...(next.priority !== undefined ? { priority: next.priority } : {}),
      ...(next.sensitivity !== undefined ? { sensitivity: next.sensitivity } : {}),
      ...(next.enabled !== undefined ? { enabled: next.enabled } : {}),
      ...(next.owner !== undefined ? { owner: next.owner } : {}),
      ...(next.metadata !== undefined ? { metadata: next.metadata } : {}),
    });
    notify();
  }

  function registryRemove(id: string): void {
    if (items.delete(id)) notify();
  }

  return {
    register: registerInternal,
    update: registryUpdate,
    patch: registryPatch,
    remove: registryRemove,
    get: (id) => items.get(id),
    list: (filter) => Array.from(items.values()).filter((item) => {
      if (filter?.enabledOnly && !item.enabled) return false;
      return matchesScope(item, filter);
    }),
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    clear() {
      if (items.size === 0) return;
      items.clear();
      notify();
    },
  };
}
