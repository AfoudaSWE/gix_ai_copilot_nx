import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineTool, createStaticToolResolver, createToolRuntime } from '@gixcopilot/tools';
import { createActionFirewall, createActionFirewallMiddleware } from '@gixcopilot/security';
import type { Identity, SecurityContext } from '@gixcopilot/security';
import { createRunId, createThreadId } from '@gixcopilot/protocol';
import { executePlan } from './plan-executor.js';
import type { Plan } from './plan.js';

const runId = createRunId();
const threadId = createThreadId();

describe('executePlan', () => {
  it('executes tool steps in dependency order, skipping steps whose dependency failed', async () => {
    const order: string[] = [];
    const stepOne = defineTool({
      name: 'step.one',
      description: 'first',
      input: z.object({}),
      execute: () => {
        order.push('one');
        return Promise.resolve({ ok: true });
      },
    });
    const stepTwo = defineTool({
      name: 'step.two',
      description: 'second, depends on first',
      input: z.object({}),
      execute: () => {
        order.push('two');
        return Promise.resolve({ ok: true });
      },
    });

    const plan: Plan = {
      id: 'p1',
      goal: 'sequential',
      steps: [
        { id: 's1', type: 'tool', target: 'step.one', description: 'first', input: {} },
        { id: 's2', type: 'tool', target: 'step.two', description: 'second', dependencies: ['s1'], input: {} },
      ],
    };

    const resolver = createStaticToolResolver([stepOne, stepTwo]);
    const toolRuntime = createToolRuntime({ resolver });

    const result = await executePlan(plan, { runId, threadId, securityContext: {}, toolRuntime });
    expect(result.status).toBe('completed');
    expect(order).toEqual(['one', 'two']);
  });

  it('skips a step whose dependency failed, rather than running it against a missing prerequisite', async () => {
    const failing = defineTool({
      name: 'step.fails',
      description: 'always fails',
      input: z.object({}),
      execute: () => Promise.reject(new Error('boom')),
    });
    const dependent = defineTool({
      name: 'step.dependent',
      description: 'depends on the failing step',
      input: z.object({}),
      execute: () => Promise.resolve({ ok: true }),
    });

    const plan: Plan = {
      id: 'p1',
      goal: 'g',
      steps: [
        { id: 's1', type: 'tool', target: 'step.fails', description: 'fails' },
        { id: 's2', type: 'tool', target: 'step.dependent', description: 'dependent', dependencies: ['s1'] },
      ],
    };

    const resolver = createStaticToolResolver([failing, dependent]);
    const toolRuntime = createToolRuntime({ resolver });
    const result = await executePlan(plan, { runId, threadId, securityContext: {}, toolRuntime });

    expect(result.status).toBe('failed');
    expect(result.steps.find((step) => step.stepId === 's1')?.status).toBe('failed');
    expect(result.steps.find((step) => step.stepId === 's2')?.status).toBe('skipped');
  });

  /**
   * Mandatory security test (Phase 10 Section 78, 191): a planner may have proposed a
   * destructive step, but the plan itself grants nothing - the real Action Firewall, wired at
   * the exact same `ToolRuntimeMiddleware` boundary every other tool call uses, still denies
   * it exactly as if a human had typed the same request.
   */
  it('does not let a plan step bypass the Action Firewall - a planned deletion is still denied', async () => {
    const deleteApplication = defineTool({
      name: 'applications.delete',
      description: 'Deletes an application permanently.',
      input: z.object({ id: z.string() }),
      security: { requiredPermissions: ['applications.delete'], risk: 'destructive' },
      execute: () => Promise.resolve({ deleted: true }),
    });

    const viewerIdentity: Identity = { subject: 'viewer-1', roles: ['viewer'], permissions: [] };
    const viewerContext: SecurityContext = { identity: viewerIdentity };

    const resolver = createStaticToolResolver([deleteApplication]);
    const firewall = createActionFirewall();
    const toolRuntime = createToolRuntime({
      resolver,
      middleware: [
        createActionFirewallMiddleware({
          firewall,
          resolver,
          getContext: () => viewerContext,
        }),
      ],
    });

    const plan: Plan = {
      id: 'p1',
      goal: 'Delete APP-1024 as the planner decided',
      steps: [{ id: 's1', type: 'tool', target: 'applications.delete', description: 'delete', input: { id: 'APP-1024' } }],
    };

    const result = await executePlan(plan, { runId, threadId, securityContext: viewerContext, toolRuntime });

    expect(result.status).toBe('failed');
    expect(result.steps[0]?.status).toBe('failed');
    expect(result.steps[0]?.error?.code).toBe('PERMISSION_DENIED');
  });

  it('rejects executing a structurally invalid plan (cycle) before running anything', async () => {
    const plan: Plan = {
      id: 'p1',
      goal: 'g',
      steps: [
        { id: 's1', type: 'model', description: 'a', dependencies: ['s2'] },
        { id: 's2', type: 'model', description: 'b', dependencies: ['s1'] },
      ],
    };
    await expect(executePlan(plan, { runId, threadId, securityContext: {} })).rejects.toMatchObject({
      code: 'AGENT_PLAN_INVALID',
    });
  });
});
