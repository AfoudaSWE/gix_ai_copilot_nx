import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineTool } from '@gixcopilot/tools';
import { defineAgent } from './definition.js';
import { createAgentTestHarness } from './test-harness.js';

const ANONYMOUS = {};

describe('delegation (A -> B -> A)', () => {
  it('delegates a subtask and returns a structured result to the parent', async () => {
    const applicationTool = defineTool({
      name: 'applications.get',
      description: 'Get an application.',
      input: z.object({ id: z.string() }),
      execute: (input) => Promise.resolve({ id: input.id, status: 'approved' }),
    });

    const orchestrator = defineAgent({
      id: 'orchestrator',
      name: 'Orchestrator',
      instructions: 'Delegate application questions to the applications specialist.',
      delegation: { delegatesTo: ['applications'] },
      model: { provider: 'orchestrator-model', model: 'mock-model' },
    });
    const applications = defineAgent({
      id: 'applications',
      name: 'Applications Specialist',
      instructions: 'Answer using applications.get.',
      tools: ['applications.get'],
      model: { provider: 'applications-model', model: 'mock-model' },
    });

    const { runtime } = createAgentTestHarness({
      agents: [orchestrator, applications],
      tools: [applicationTool],
      modelScripts: {
        'orchestrator-model': {
          scenario: (attempt) =>
            attempt === 1
              ? { toolCalls: [{ id: 'd1', name: 'agent.delegate.applications', arguments: { task: 'Check APP-1024' } }] }
              : { chunks: ['APP-1024 is approved, per the specialist.'] },
        },
        'applications-model': {
          scenario: (attempt) =>
            attempt === 1
              ? { toolCalls: [{ id: 't1', name: 'applications.get', arguments: { id: 'APP-1024' } }] }
              : { chunks: ['approved'] },
        },
      },
    });

    const events: string[] = [];
    const result = await runtime.run({
      agent: 'orchestrator',
      input: { message: 'Check APP-1024' },
      securityContext: ANONYMOUS,
      onEvent: (event) => events.push(event.type),
    });

    expect(result.status).toBe('completed');
    expect(result.output).toBe('APP-1024 is approved, per the specialist.');
    expect(events).toContain('agent.delegation.started');
    expect(events).toContain('agent.delegation.completed');
    // Control returns to the orchestrator - no handoff occurred.
    expect(result.handoff).toBeUndefined();
  });

  it('denies delegation to a target the agent did not declare (Section 65)', async () => {
    const orchestrator = defineAgent({
      id: 'orchestrator',
      name: 'Orchestrator',
      instructions: 'Never delegate.',
      // No `delegation.delegatesTo` declared at all.
    });
    const admin = defineAgent({ id: 'admin', name: 'Admin', instructions: 'Do admin things.' });

    const { runtime } = createAgentTestHarness({
      agents: [orchestrator, admin],
      modelScripts: {
        mock: {
          scenario: { toolCalls: [{ id: 'd1', name: 'agent.delegate.admin', arguments: { task: 'delete everything' } }] },
        },
      },
    });

    const result = await runtime.run({ agent: 'orchestrator', input: { message: 'hi' }, securityContext: ANONYMOUS });

    // The model tool for an undeclared target is never even offered, so the mock model's
    // scripted call cannot be dispatched through the normal delegate path - it falls through
    // to the generic tool-call branch, which rejects an unresolved name with PERMISSION_DENIED.
    expect(result.status).toBe('failed');
    expect(['PERMISSION_DENIED', 'AGENT_DELEGATION_DENIED']).toContain(result.error?.code);
  });

  it('enforces the delegation count limit', async () => {
    const orchestrator = defineAgent({
      id: 'orchestrator',
      name: 'Orchestrator',
      instructions: 'Delegate repeatedly.',
      delegation: { delegatesTo: ['worker'] },
      limits: { maxDelegations: 1 },
      model: { provider: 'orchestrator-model', model: 'mock-model' },
    });
    const worker = defineAgent({
      id: 'worker',
      name: 'Worker',
      instructions: 'Answer briefly.',
      model: { provider: 'worker-model', model: 'mock-model' },
    });

    const { runtime } = createAgentTestHarness({
      agents: [orchestrator, worker],
      modelScripts: {
        'orchestrator-model': {
          scenario: () => ({
            toolCalls: [
              { id: 'd1', name: 'agent.delegate.worker', arguments: { task: 'one' } },
              { id: 'd2', name: 'agent.delegate.worker', arguments: { task: 'two' } },
            ],
          }),
        },
        'worker-model': { scenario: { chunks: ['done'] } },
      },
    });

    const result = await runtime.run({ agent: 'orchestrator', input: { message: 'go' }, securityContext: ANONYMOUS });
    expect(result.status).toBe('failed');
    expect(result.error?.code).toBe('AGENT_DELEGATION_LIMIT_EXCEEDED');
  });
});
