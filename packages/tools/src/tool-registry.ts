import { CopilotError } from '@gixcopilot/protocol';
import type { ToolSource } from '@gixcopilot/protocol';
import { assertValidToolName } from './tool-name.js';
import type { AnyToolDefinition } from './tool-definition.js';

/**
 * A live handle returned by `register()` (Section 18) - mirrors `@gixcopilot/context`'s
 * `ContextRegistration` lifecycle convention so `useFrontendTool` can reuse the same
 * register-in-effect/dispose-on-unmount pattern as `useCopilotContext`.
 */
export interface ToolRegistration {
  readonly name: string;
  /** Replace this tool's definition in place, keeping the same registration slot. */
  update(next: AnyToolDefinition): void;
  /** Idempotent. Removes the tool from the registry; safe to call more than once. */
  dispose(): void;
}

export interface ToolRegisterOptions {
  /**
   * Duplicate handling (Section 19): registering an already-registered name throws by
   * default (reject duplicate) - a silent replace is a common source of "which
   * implementation actually ran" bugs. Pass `replace: true` for the explicit, intentional
   * case (e.g. a React component re-registering its own tool after a hot update).
   */
  readonly replace?: boolean;
}

export interface ToolListFilter {
  /** Defaults to `false` - `list()` returns disabled tools too unless this is `true`. */
  readonly enabledOnly?: boolean;
  readonly category?: string;
  readonly tags?: readonly string[];
  readonly source?: ToolSource;
}

/**
 * The central, framework-independent tool registry (Section 17). One registry is one
 * isolated universe of tools - a server process may own one registry for its backend
 * tools, and each `CopilotProvider` instance owns its own registry for frontend tools
 * (mirroring `@gixcopilot/context`'s per-provider isolation, Section 65's precedent) so
 * sibling/nested providers never see each other's tools.
 */
export interface ToolRegistry {
  register(tool: AnyToolDefinition, options?: ToolRegisterOptions): ToolRegistration;
  unregister(name: string): void;
  has(name: string): boolean;
  get(name: string): AnyToolDefinition | undefined;
  list(filter?: ToolListFilter): readonly AnyToolDefinition[];
  subscribe(listener: () => void): () => void;
  /** Removes every tool. Primarily for provider teardown/tests. */
  clear(): void;
}

function matchesFilter(tool: AnyToolDefinition, filter: ToolListFilter | undefined): boolean {
  if (!filter) return true;
  if (filter.category !== undefined && tool.metadata?.category !== filter.category) return false;
  if (filter.source !== undefined && tool.metadata?.source !== filter.source) return false;
  if (filter.tags !== undefined) {
    const tags = tool.metadata?.tags ?? [];
    if (!filter.tags.every((tag) => tags.includes(tag))) return false;
  }
  return true;
}

export function createToolRegistry(): ToolRegistry {
  const tools = new Map<string, AnyToolDefinition>();
  const listeners = new Set<() => void>();

  function notify(): void {
    for (const listener of listeners) listener();
  }

  function registryUnregister(name: string): void {
    if (tools.delete(name)) notify();
  }

  function registerInternal(
    tool: AnyToolDefinition,
    options: ToolRegisterOptions = {},
  ): ToolRegistration {
    assertValidToolName(tool.name);
    if (tools.has(tool.name) && !options.replace) {
      throw CopilotError.validation(
        `A tool named "${tool.name}" is already registered. Pass { replace: true } to ` +
          'intentionally replace an existing tool.',
        { name: tool.name },
      );
    }
    tools.set(tool.name, tool);
    notify();

    let disposed = false;
    return {
      name: tool.name,
      update(next: AnyToolDefinition) {
        if (disposed) return;
        if (next.name !== tool.name) {
          throw CopilotError.validation(
            'A tool registration cannot be updated to a different name; unregister and ' +
              'register a new tool instead.',
            { from: tool.name, to: next.name },
          );
        }
        tools.set(tool.name, next);
        notify();
      },
      dispose() {
        if (disposed) return;
        disposed = true;
        registryUnregister(tool.name);
      },
    };
  }

  return {
    register: registerInternal,
    unregister: registryUnregister,
    has: (name) => tools.has(name),
    get: (name) => tools.get(name),
    list: (filter) => Array.from(tools.values()).filter((tool) => matchesFilter(tool, filter)),
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    clear() {
      if (tools.size === 0) return;
      tools.clear();
      notify();
    },
  };
}
