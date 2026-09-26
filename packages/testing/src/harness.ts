import { z } from 'zod';
import { defineAgent } from '@gixcopilot/agents';
import type { AgentRunResult } from '@gixcopilot/agents';
import type { DevToolsSession } from '@gixcopilot/devtools';
import type { ModelProvider } from '@gixcopilot/provider';
import type { SecurityContext } from '@gixcopilot/security';
import type { RecordingTelemetry, TelemetryMode } from '@gixcopilot/telemetry';
import { defineTool } from '@gixcopilot/tools';
import type { AnyToolDefinition } from '@gixcopilot/tools';
import type { KnowledgeFixture } from './knowledge.js';
import type { MemoryFixture } from './memory.js';
import type { SecurityFixture } from './security.js';
import { createAgentSimulation } from './simulation.js';
import type { AgentSimulation } from './simulation.js';
import type { ToolMocks } from './tools.js';

export interface CopilotTestHarnessOptions {
  readonly model: ModelProvider;
  readonly tools?: ToolMocks | readonly AnyToolDefinition[];
  readonly knowledge?: KnowledgeFixture;
  readonly memory?: MemoryFixture;
  readonly security?: SecurityFixture;
  readonly instructions?: string;
  readonly telemetryMode?: TelemetryMode;
  readonly toolTimeoutMs?: number;
}

export interface CopilotTestRun {
  readonly result: AgentRunResult;
  /** The final answer text, when the run completed. */
  readonly answer?: string;
  /** DevTools' view of this run - what a developer would inspect (Section 219). */
  readonly session: DevToolsSession;
}

export interface CopilotTestHarness {
  readonly simulation: AgentSimulation;
  readonly telemetry: RecordingTelemetry;
  readonly tools: readonly AnyToolDefinition[];
  run(message: string, options?: { readonly securityContext?: SecurityContext; readonly signal?: AbortSignal }): Promise<CopilotTestRun>;
}

function trusted(metadata: unknown): SecurityContext {
  const context = (metadata as { securityContext?: SecurityContext } | undefined)?.securityContext;
  if (!context) throw new Error('Tool requires a trusted SecurityContext.');
  return context;
}

function memoryTools(fixture: MemoryFixture): AnyToolDefinition[] {
  return [
    defineTool({
      name: 'memory.recall',
      description: "Search the current user's own saved memory.",
      input: z.object({ query: z.string().optional() }),
      security: { risk: 'read-only' },
      execute: async (input, context) => {
        const results = await fixture.serviceFor(trusted(context.metadata)).search(input.query ? { text: input.query, topK: 5 } : { topK: 5 });
        return { results: results.map((result) => ({ id: result.record.id, value: result.record.value })) };
      },
    }),
    defineTool({
      name: 'memory.save',
      description: 'Remember a durable fact about the current user.',
      input: z.object({ value: z.string() }),
      // Writes only the trusted caller's own memory (the service binds the owner), and the
      // Phase 9 write policy still applies - so no human approval is needed per write.
      security: { risk: 'write', approval: 'none' },
      execute: async (input, context) => {
        const record = await fixture.serviceFor(trusted(context.metadata)).save({ type: 'durable', value: input.value, provenance: 'application-generated' }, true);
        return { saved: true, id: record.id };
      },
    }),
  ];
}

/**
 * One-call deterministic copilot rig (Section 72): a real agent runtime, real tool runtime,
 * real Action Firewall, real RAG and memory - only the model is scripted. Every run is also
 * recorded, so a test can assert on the same DevTools view a developer would open.
 */
export function createCopilotTestHarness(options: CopilotTestHarnessOptions): CopilotTestHarness {
  const base = options.tools === undefined ? [] : 'mock' in options.tools ? options.tools.tools : options.tools;
  const tools: AnyToolDefinition[] = [
    ...base,
    ...(options.knowledge ? [options.knowledge.searchTool()] : []),
    ...(options.memory ? memoryTools(options.memory) : []),
  ];
  const agent = defineAgent({
    id: 'copilot',
    name: 'Copilot',
    instructions: options.instructions ?? 'Help the user using the available tools.',
    tools: tools.map((tool) => tool.name),
    model: { provider: options.model.id, model: 'test-model' },
  });
  const simulation = createAgentSimulation({
    agents: [agent],
    models: [options.model],
    tools,
    security: options.security,
    telemetryMode: options.telemetryMode,
    toolTimeoutMs: options.toolTimeoutMs,
  });
  return {
    simulation,
    telemetry: simulation.telemetry,
    tools,
    async run(message, runOptions = {}) {
      const result = await simulation.run('copilot', message, runOptions);
      return {
        result,
        answer: result.status === 'completed' ? String(result.output) : undefined,
        session: simulation.session(),
      };
    },
  };
}
