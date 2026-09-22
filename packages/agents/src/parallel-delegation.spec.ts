import { describe, expect, it } from 'vitest';
import { defineAgent } from './definition.js';
import { createAgentTestHarness } from './test-harness.js';

const ANONYMOUS = {};

interface RecordedEvent {
  readonly type: string;
  readonly agentId?: string;
  readonly agentRunId?: string;
  readonly toAgentId?: string;
  readonly status?: string;
}

function specialist(id: string) {
  return defineAgent({
    id,
    name: id,
    instructions: `Answer as ${id}.`,
    model: { provider: `${id}-model`, model: 'mock-model' },
  });
}

/**
 * Mandatory (Phase 10 Section 70-73, 189): an orchestrator that requests more than one
 * delegation in the same model turn runs them concurrently, with correct run-ID correlation,
 * a real partial-failure policy, and cancellation propagation into every in-flight sibling.
 */
describe('parallel specialist delegation', () => {
  it('runs three specialists concurrently, each with its own correlated run', async () => {
    const orchestrator = defineAgent({
      id: 'orchestrator',
      name: 'Orchestrator',
      instructions: 'Delegate to three specialists at once.',
      delegation: { delegatesTo: ['a', 'b', 'c'] },
      model: { provider: 'orchestrator-model', model: 'mock-model' },
    });

    const { runtime } = createAgentTestHarness({
      agents: [orchestrator, specialist('a'), specialist('b'), specialist('c')],
      modelScripts: {
        'orchestrator-model': {
          scenario: (attempt) =>
            attempt === 1
              ? {
                  toolCalls: [
                    { id: 'd1', name: 'agent.delegate.a', arguments: { task: 'a task' } },
                    { id: 'd2', name: 'agent.delegate.b', arguments: { task: 'b task' } },
                    { id: 'd3', name: 'agent.delegate.c', arguments: { task: 'c task' } },
                  ],
                }
              : { chunks: ['combined answer'] },
        },
        'a-model': { scenario: { chunks: ['answer from a'] } },
        'b-model': { scenario: { chunks: ['answer from b'] } },
        'c-model': { scenario: { chunks: ['answer from c'] } },
      },
    });

    const events: RecordedEvent[] = [];
    const result = await runtime.run({
      agent: 'orchestrator',
      input: { message: 'go' },
      securityContext: ANONYMOUS,
      onEvent: (event) => events.push(event as RecordedEvent),
    });

    expect(result.status).toBe('completed');

    const started = events.filter((event) => event.type === 'agent.delegation.started');
    expect(started.map((event) => event.toAgentId).sort()).toEqual(['a', 'b', 'c']);

    const completed = events.filter((event) => event.type === 'agent.delegation.completed');
    expect(completed).toHaveLength(3);
    expect(completed.every((event) => event.status === 'completed')).toBe(true);

    // Each specialist ran its own, distinctly-correlated agent run (Section 16, 189).
    const childRunsStarted = events.filter(
      (event) => event.type === 'agent.run.started' && event.agentId !== 'orchestrator',
    );
    expect(childRunsStarted.map((event) => event.agentId).sort()).toEqual(['a', 'b', 'c']);
    const runIds = new Set(childRunsStarted.map((event) => event.agentRunId));
    expect(runIds.size).toBe(3);
  });

  it('collect-results (default): one specialist failing does not stop the others', async () => {
    const orchestrator = defineAgent({
      id: 'orchestrator',
      name: 'Orchestrator',
      instructions: 'Delegate to three specialists at once.',
      delegation: { delegatesTo: ['a', 'b', 'c'] },
      model: { provider: 'orchestrator-model', model: 'mock-model' },
    });

    const { runtime } = createAgentTestHarness({
      agents: [orchestrator, specialist('a'), specialist('b'), specialist('c')],
      modelScripts: {
        'orchestrator-model': {
          scenario: (attempt) =>
            attempt === 1
              ? {
                  toolCalls: [
                    { id: 'd1', name: 'agent.delegate.a', arguments: { task: 'a task' } },
                    { id: 'd2', name: 'agent.delegate.b', arguments: { task: 'b task' } },
                    { id: 'd3', name: 'agent.delegate.c', arguments: { task: 'c task' } },
                  ],
                }
              : { chunks: ['combined answer despite one failure'] },
        },
        'a-model': { scenario: { chunks: ['answer from a'] } },
        'b-model': { scenario: { failBeforeFirstChunk: { code: 'PROVIDER_ERROR', message: 'b is down' } } },
        'c-model': { scenario: { chunks: ['answer from c'] } },
      },
    });

    const events: RecordedEvent[] = [];
    const result = await runtime.run({
      agent: 'orchestrator',
      input: { message: 'go' },
      securityContext: ANONYMOUS,
      onEvent: (event) => events.push(event as RecordedEvent),
    });

    // The orchestrator still completes overall - it received all three structured results
    // (two successes, one failure) and could reason about the partial outcome.
    expect(result.status).toBe('completed');
    const completed = events.filter((event) => event.type === 'agent.delegation.completed');
    expect(completed).toHaveLength(3);
    const byTarget = new Map(completed.map((event) => [event.toAgentId, event.status]));
    expect(byTarget.get('a')).toBe('completed');
    expect(byTarget.get('b')).toBe('failed');
    expect(byTarget.get('c')).toBe('completed');
  });

  it('fail-fast: one specialist failing cancels the still-running siblings', async () => {
    let cStarted!: () => void;
    const cStartedPromise = new Promise<void>((resolve) => {
      cStarted = resolve;
    });

    const orchestrator = defineAgent({
      id: 'orchestrator',
      name: 'Orchestrator',
      instructions: 'Delegate to three specialists at once.',
      delegation: { delegatesTo: ['a', 'b', 'c'], parallelFailurePolicy: 'fail-fast' },
      model: { provider: 'orchestrator-model', model: 'mock-model' },
    });

    const { runtime } = createAgentTestHarness({
      agents: [orchestrator, specialist('a'), specialist('b'), specialist('c')],
      modelScripts: {
        'orchestrator-model': {
          scenario: (attempt) =>
            attempt === 1
              ? {
                  toolCalls: [
                    { id: 'd1', name: 'agent.delegate.a', arguments: { task: 'a task' } },
                    { id: 'd2', name: 'agent.delegate.b', arguments: { task: 'b task' } },
                    { id: 'd3', name: 'agent.delegate.c', arguments: { task: 'c task' } },
                  ],
                }
              : { chunks: ['done'] },
        },
        // b fails immediately.
        'b-model': { scenario: { failBeforeFirstChunk: { code: 'PROVIDER_ERROR', message: 'b is down' } } },
        // a and c both stream slowly enough that b's immediate failure reaches them first;
        // c additionally signals when it has actually started, so the test can assert it was
        // genuinely interrupted rather than merely finishing before b failed.
        'a-model': { scenario: { chunks: ['slow a'], delayMsPerChunk: 50 } },
        'c-model': {
          scenario: () => {
            cStarted();
            return { chunks: ['slow c'], delayMsPerChunk: 50 };
          },
        },
      },
    });

    const events: RecordedEvent[] = [];
    const result = await runtime.run({
      agent: 'orchestrator',
      input: { message: 'go' },
      securityContext: ANONYMOUS,
      onEvent: (event) => events.push(event as RecordedEvent),
    });
    await cStartedPromise;

    const completed = events.filter((event) => event.type === 'agent.delegation.completed');
    expect(completed).toHaveLength(3);
    const byTarget = new Map(completed.map((event) => [event.toAgentId, event.status]));
    expect(byTarget.get('b')).toBe('failed');
    // a and c were both aborted once b failed (Section 71) - neither reports 'completed'.
    expect(byTarget.get('a')).toBe('failed');
    expect(byTarget.get('c')).toBe('failed');
    expect(result.status).toBe('completed');
  });

  it('cancelling the parent run cancels every in-flight parallel delegation', async () => {
    let aStarted!: () => void;
    const aStartedPromise = new Promise<void>((resolve) => {
      aStarted = resolve;
    });

    const orchestrator = defineAgent({
      id: 'orchestrator',
      name: 'Orchestrator',
      instructions: 'Delegate to two specialists at once.',
      delegation: { delegatesTo: ['a', 'b'] },
      model: { provider: 'orchestrator-model', model: 'mock-model' },
    });

    const { runtime } = createAgentTestHarness({
      agents: [orchestrator, specialist('a'), specialist('b')],
      modelScripts: {
        'orchestrator-model': {
          scenario: {
            toolCalls: [
              { id: 'd1', name: 'agent.delegate.a', arguments: { task: 'a task' } },
              { id: 'd2', name: 'agent.delegate.b', arguments: { task: 'b task' } },
            ],
          },
        },
        'a-model': {
          scenario: () => {
            aStarted();
            return { chunks: ['slow a'], delayMsPerChunk: 100 };
          },
        },
        'b-model': { scenario: { chunks: ['slow b'], delayMsPerChunk: 100 } },
      },
    });

    const controller = new AbortController();
    const runPromise = runtime.run({
      agent: 'orchestrator',
      input: { message: 'go' },
      securityContext: ANONYMOUS,
      signal: controller.signal,
    });
    await aStartedPromise;
    controller.abort();

    const result = await runPromise;
    expect(result.status).toBe('cancelled');
  });
});
