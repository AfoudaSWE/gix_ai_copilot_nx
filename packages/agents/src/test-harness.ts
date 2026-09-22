import { createModelRuntime } from '@gixcopilot/provider';
import type { ModelRuntime } from '@gixcopilot/provider';
import { createMockProvider } from '@gixcopilot/provider-mock';
import type { MockProviderOptions } from '@gixcopilot/provider-mock';
import { createStaticToolResolver, createToolRuntime } from '@gixcopilot/tools';
import type { AnyToolDefinition, ToolResolver, ToolRuntime, ToolRuntimeMiddleware } from '@gixcopilot/tools';
import { createAgentRegistry } from './registry.js';
import type { AgentRegistry } from './registry.js';
import { createAgentRuntime } from './runtime.js';
import type { AgentRuntime } from './runtime.js';
import type { AnyAgentDefinition } from './definition.js';

export type AgentTestModelScript = Omit<MockProviderOptions, 'id'>;

export interface CreateAgentTestHarnessOptions {
  readonly agents: readonly AnyAgentDefinition[];
  readonly tools?: readonly AnyToolDefinition[];
  /**
   * Provider id -> deterministic model script (Section 231-232), so different agents (via
   * their own `model: { provider: '<id>' }`) can be scripted independently in the same test -
   * important for delegation/handoff/multi-agent tests, where each agent needs its own
   * conversation turns. An agent with no `model.provider` uses whichever script comes first
   * (or a no-op default "mock" script if none is given).
   */
  readonly modelScripts?: Readonly<Record<string, AgentTestModelScript>>;
  readonly toolResolver?: ToolResolver;
  readonly toolMiddleware?: readonly ToolRuntimeMiddleware[];
}

export interface AgentTestHarness {
  readonly registry: AgentRegistry;
  readonly modelRuntime: ModelRuntime;
  readonly toolRuntime: ToolRuntime;
  readonly runtime: AgentRuntime;
}

/**
 * A zero-network, zero-Redis, zero-Postgres test rig (Section 231-233): every deterministic
 * test in this package is built on this, never a real provider or database. Mirrors
 * `@gixcopilot/provider-mock`'s own "no external model or content-matching involved" design.
 */
export function createAgentTestHarness(options: CreateAgentTestHarnessOptions): AgentTestHarness {
  const registry = createAgentRegistry();
  for (const agent of options.agents) registry.register(agent);

  const scriptEntries = Object.entries(options.modelScripts ?? { mock: {} });
  const providers = scriptEntries.map(([id, script]) => createMockProvider({ ...script, id }));
  const defaultProviderId = providers[0]?.id ?? 'mock';
  if (providers.length === 0) providers.push(createMockProvider({ id: defaultProviderId }));

  const modelRuntime = createModelRuntime({
    providers,
    defaultProvider: defaultProviderId,
    defaultModel: 'mock-model',
  });

  const resolver = options.toolResolver ?? createStaticToolResolver(options.tools ?? []);
  const toolRuntime = createToolRuntime({ resolver, middleware: options.toolMiddleware });

  const runtime = createAgentRuntime({ registry, modelRuntime, toolRuntime, toolResolver: resolver });

  return { registry, modelRuntime, toolRuntime, runtime };
}
