import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineTool } from '@gixcopilot/tools';
import { createAgentTestHarness } from './test-harness.js';
import { defineAgent } from './definition.js';

const ANONYMOUS = {};

describe('createAgentRuntime - single agent round trip', () => {
  it('answers directly with no tool call needed', async () => {
    const supportAgent = defineAgent({
      id: 'support',
      name: 'Support Agent',
      instructions: 'Help users understand the product.',
    });

    const { runtime } = createAgentTestHarness({
      agents: [supportAgent],
      modelScripts: { mock: { scenario: { chunks: ['Hello, how can I help?'] } } },
    });

    const result = await runtime.run({
      agent: 'support',
      input: { message: 'Hi there' },
      securityContext: ANONYMOUS,
    });

    expect(result.status).toBe('completed');
    expect(result.output).toBe('Hello, how can I help?');
    expect(result.iterations).toBe(0);
  });

  it('calls a real backend tool through the tool runtime, then answers', async () => {
    const getApplication = defineTool({
      name: 'applications.get',
      description: 'Get an application by id.',
      input: z.object({ id: z.string() }),
      execute: (input) => Promise.resolve({ id: input.id, status: 'approved' }),
    });

    const applicationAgent = defineAgent({
      id: 'application',
      name: 'Application Agent',
      instructions: 'Answer questions about applications using the applications.get tool.',
      tools: ['applications.get'],
    });

    const { runtime } = createAgentTestHarness({
      agents: [applicationAgent],
      tools: [getApplication],
      modelScripts: {
        mock: {
          scenario: (attempt) =>
            attempt === 1
              ? { toolCalls: [{ id: 'call-1', name: 'applications.get', arguments: { id: 'APP-1024' } }] }
              : { chunks: ['APP-1024 is approved.'] },
        },
      },
    });

    const result = await runtime.run({
      agent: 'application',
      input: { message: 'Check APP-1024' },
      securityContext: ANONYMOUS,
    });

    expect(result.status).toBe('completed');
    expect(result.output).toBe('APP-1024 is approved.');
    expect(result.iterations).toBe(1);
    expect(result.toolCallCount).toBe(1);
  });

  it('rejects agent input that fails its declared schema', async () => {
    const typed = defineAgent({
      id: 'typed',
      name: 'Typed Agent',
      instructions: 'Echo.',
      input: z.object({ applicationId: z.string() }),
    });

    const { runtime } = createAgentTestHarness({ agents: [typed] });

    const result = await runtime.run({
      agent: 'typed',
      input: { wrong: 'shape' },
      securityContext: ANONYMOUS,
    });

    expect(result.status).toBe('failed');
    expect(result.error?.code).toBe('AGENT_INPUT_INVALID');
  });

  it('fails with AGENT_NOT_FOUND for an unregistered agent id', async () => {
    const { runtime } = createAgentTestHarness({ agents: [] });

    const result = await runtime.run({
      agent: 'missing',
      input: { message: 'hi' },
      securityContext: ANONYMOUS,
    });

    expect(result.status).toBe('failed');
    expect(result.error?.code).toBe('AGENT_NOT_FOUND');
  });

  /** Mandatory (Section 179): an intentionally looping test model must never run forever. */
  it('stops a looping model with ITERATION_LIMIT rather than looping forever', async () => {
    const loopingTool = defineTool({
      name: 'loop.tool',
      description: 'A tool the model keeps calling.',
      input: z.object({}),
      execute: () => Promise.resolve({ ok: true }),
    });
    const agent = defineAgent({
      id: 'looper',
      name: 'Looper',
      instructions: 'Keep calling loop.tool forever.',
      tools: ['loop.tool'],
      limits: { maxIterations: 3 },
    });

    const { runtime } = createAgentTestHarness({
      agents: [agent],
      tools: [loopingTool],
      modelScripts: {
        mock: { scenario: { toolCalls: [{ id: 'call', name: 'loop.tool', arguments: {} }] } },
      },
    });

    const result = await runtime.run({ agent: 'looper', input: { message: 'go' }, securityContext: ANONYMOUS });
    expect(result.status).toBe('failed');
    expect(result.error?.code).toBe('AGENT_ITERATION_LIMIT_EXCEEDED');
  });

  /** Mandatory (Section 180): excessive tool calls must stop the run too, independent of
   * the iteration count (a single turn can request more than one tool call). */
  it('stops excessive tool calls with TOOL_LIMIT_EXCEEDED', async () => {
    const noopTool = defineTool({
      name: 'noop',
      description: 'Does nothing.',
      input: z.object({}),
      execute: () => Promise.resolve({}),
    });
    const agent = defineAgent({
      id: 'spammer',
      name: 'Spammer',
      instructions: 'Call noop many times in one turn.',
      tools: ['noop'],
      limits: { maxToolCalls: 2, maxIterations: 20 },
    });

    const { runtime } = createAgentTestHarness({
      agents: [agent],
      tools: [noopTool],
      modelScripts: {
        mock: {
          scenario: {
            toolCalls: [
              { id: 'c1', name: 'noop', arguments: {} },
              { id: 'c2', name: 'noop', arguments: {} },
              { id: 'c3', name: 'noop', arguments: {} },
            ],
          },
        },
      },
    });

    const result = await runtime.run({ agent: 'spammer', input: { message: 'go' }, securityContext: ANONYMOUS });
    expect(result.status).toBe('failed');
    expect(result.error?.code).toBe('AGENT_TOOL_LIMIT_EXCEEDED');
  });

  it('emits agent.run.started/completed events in order', async () => {
    const agent = defineAgent({ id: 'echo', name: 'Echo Agent', instructions: 'Echo.' });
    const { runtime } = createAgentTestHarness({
      agents: [agent],
      modelScripts: { mock: { scenario: { chunks: ['ok'] } } },
    });

    const events: string[] = [];
    await runtime.run({
      agent: 'echo',
      input: { message: 'hi' },
      securityContext: ANONYMOUS,
      onEvent: (event) => events.push(event.type),
    });

    expect(events).toEqual(['agent.run.started', 'agent.run.completed']);
  });

  /** Mandatory (Section 203): cancelling while the model is still streaming must end the run
   * as 'cancelled', not 'failed' or a truncated 'completed'. */
  it('cancels a run aborted mid model-call', async () => {
    const agent = defineAgent({
      id: 'slow-thinker',
      name: 'Slow Thinker',
      instructions: 'Think slowly.',
    });
    const { runtime } = createAgentTestHarness({
      agents: [agent],
      modelScripts: {
        mock: { scenario: { chunks: ['one', 'two', 'three'], delayMsPerChunk: 20 } },
      },
    });

    const controller = new AbortController();
    const runPromise = runtime.run({
      agent: 'slow-thinker',
      input: { message: 'hi' },
      securityContext: ANONYMOUS,
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 5);

    const result = await runPromise;
    expect(result.status).toBe('cancelled');
  });

  /** Mandatory (Section 203): cancelling while a tool call is in flight must also end the run
   * as 'cancelled' - the abort signal reaches the tool's own execution context (Section 45). */
  it('cancels a run aborted mid tool-call', async () => {
    let toolStarted!: () => void;
    const toolStartedPromise = new Promise<void>((resolve) => {
      toolStarted = resolve;
    });
    const hangingTool = defineTool({
      name: 'hang',
      description: 'Never resolves on its own - only settles once its execution signal aborts.',
      input: z.object({}),
      execute: (_input, context) =>
        new Promise((_resolve, reject) => {
          toolStarted();
          context.signal.addEventListener('abort', () => reject(new Error('tool aborted')), { once: true });
        }),
    });
    const agent = defineAgent({
      id: 'hanger',
      name: 'Hanger',
      instructions: 'Call hang.',
      tools: ['hang'],
    });
    const { runtime } = createAgentTestHarness({
      agents: [agent],
      tools: [hangingTool],
      modelScripts: { mock: { scenario: { toolCalls: [{ id: 'call', name: 'hang', arguments: {} }] } } },
    });

    const controller = new AbortController();
    const runPromise = runtime.run({
      agent: 'hanger',
      input: { message: 'go' },
      securityContext: ANONYMOUS,
      signal: controller.signal,
    });
    await toolStartedPromise;
    controller.abort();

    const result = await runPromise;
    expect(result.status).toBe('cancelled');
  });

  /** Mandatory (Section 45, 204): a run whose model never finishes in time must fail with
   * AGENT_TIMEOUT rather than hang forever. */
  it('fails a run that exceeds its configured timeout', async () => {
    const agent = defineAgent({
      id: 'eternal',
      name: 'Eternal',
      instructions: 'Take forever to answer.',
      limits: { timeoutMs: 10 },
    });
    const { runtime } = createAgentTestHarness({
      agents: [agent],
      modelScripts: {
        mock: { scenario: { chunks: ['a', 'b', 'c', 'd', 'e'], delayMsPerChunk: 50 } },
      },
    });

    const result = await runtime.run({ agent: 'eternal', input: { message: 'hi' }, securityContext: ANONYMOUS });
    expect(result.status).toBe('failed');
    expect(result.error?.code).toBe('AGENT_TIMEOUT');
  });
});
