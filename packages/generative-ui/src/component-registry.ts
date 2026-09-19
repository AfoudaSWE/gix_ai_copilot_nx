import { CopilotError } from '@gixcopilot/protocol';
import type { AnyGenerativeComponentDefinition } from './component-definition.js';

/**
 * A live handle returned by `register()` (Section 11) - mirrors `@gixcopilot/tools`'
 * `ToolRegistration` lifecycle convention, since every registered component is bridged into
 * a reserved tool (`generative-ui-tool.ts`) the same way a real tool is registered.
 */
export interface GenerativeComponentRegistration {
  readonly name: string;
  /** Replace this component's definition in place, keeping the same registration slot. */
  update(next: AnyGenerativeComponentDefinition): void;
  /** Idempotent. Removes the component from the registry; safe to call more than once. */
  dispose(): void;
}

export interface GenerativeComponentRegisterOptions {
  /** Duplicate handling (Section 72): rejected by default; pass `replace: true` to intend it. */
  readonly replace?: boolean;
}

export interface GenerativeComponentListFilter {
  readonly enabledOnly?: boolean;
  readonly category?: string;
  readonly tags?: readonly string[];
}

function matchesFilter(
  component: AnyGenerativeComponentDefinition,
  filter: GenerativeComponentListFilter | undefined,
): boolean {
  if (!filter) return true;
  if (filter.category !== undefined && component.metadata?.category !== filter.category) return false;
  if (filter.tags !== undefined) {
    const tags = component.metadata?.tags ?? [];
    if (!filter.tags.every((tag) => tags.includes(tag))) return false;
  }
  return true;
}

/**
 * The trusted component registry (Section 11): name -> `GenerativeComponentDefinition`. One
 * registry is one isolated universe - a host creates one per independent Copilot instance
 * (mirroring `@gixcopilot/tools`' and `@gixcopilot/context`'s own per-provider isolation
 * convention), never a mandatory global singleton.
 */
export interface GenerativeComponentRegistry {
  register(
    component: AnyGenerativeComponentDefinition,
    options?: GenerativeComponentRegisterOptions,
  ): GenerativeComponentRegistration;
  unregister(name: string): void;
  has(name: string): boolean;
  get(name: string): AnyGenerativeComponentDefinition | undefined;
  list(filter?: GenerativeComponentListFilter): readonly AnyGenerativeComponentDefinition[];
  subscribe(listener: () => void): () => void;
  /** Removes every component. Primarily for provider teardown/tests. */
  clear(): void;
}

export function createGenerativeComponentRegistry(): GenerativeComponentRegistry {
  const components = new Map<string, AnyGenerativeComponentDefinition>();
  const listeners = new Set<() => void>();

  function notify(): void {
    for (const listener of listeners) listener();
  }

  function registryUnregister(name: string): void {
    if (components.delete(name)) notify();
  }

  function requireName(name: string): void {
    if (!name.trim()) {
      throw CopilotError.validation('A generative component requires a non-empty name.');
    }
  }

  function registerInternal(
    component: AnyGenerativeComponentDefinition,
    options: GenerativeComponentRegisterOptions = {},
  ): GenerativeComponentRegistration {
    requireName(component.name);
    if (components.has(component.name) && !options.replace) {
      throw CopilotError.validation(
        `A generative component named "${component.name}" is already registered. Pass ` +
          '{ replace: true } to intentionally replace it.',
        { name: component.name },
      );
    }
    components.set(component.name, component);
    notify();

    let disposed = false;
    return {
      name: component.name,
      update(next: AnyGenerativeComponentDefinition) {
        if (disposed) return;
        if (next.name !== component.name) {
          throw CopilotError.validation(
            'A component registration cannot be updated to a different name; unregister and ' +
              'register a new component instead.',
            { from: component.name, to: next.name },
          );
        }
        components.set(component.name, next);
        notify();
      },
      dispose() {
        if (disposed) return;
        disposed = true;
        registryUnregister(component.name);
      },
    };
  }

  return {
    register: registerInternal,
    unregister: registryUnregister,
    has: (name) => components.has(name),
    get: (name) => components.get(name),
    list: (filter) => Array.from(components.values()).filter((component) => matchesFilter(component, filter)),
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    clear() {
      if (components.size === 0) return;
      components.clear();
      notify();
    },
  };
}
