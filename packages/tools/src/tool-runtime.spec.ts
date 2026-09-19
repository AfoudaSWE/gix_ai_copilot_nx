import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createToolCallId, createRunId } from '@gixcopilot/protocol';
import { defineTool } from './define-tool.js';
import { createToolRegistry } from './tool-registry.js';
import { createDefaultToolResolver, createStaticToolResolver } from './tool-resolver.js';
import { createToolRuntime } from './tool-runtime.js';
import type { ToolExecutionContext } from './tool-definition.js';
import type { ToolInvocationRequest } from './tool-runtime.js';

function context(signal: AbortSignal = new AbortController().signal): ToolExecutionContext {
  return { runId: createRunId(), signal };
}

function request(
  name: string,
  args: unknown,
  overrides: Partial<ToolInvocationRequest> = {},
): ToolInvocationRequest {
  return { toolCallId: createToolCallId(), name, arguments: args, context: context(), ...overrides };
}

describe('createToolRuntime', () => {
  it('executes a valid call end to end and reports success', async () => {
    const registry = createToolRegistry();
    registry.register(
      defineTool({
        name: 'math.add',
        description: 'x',
        input: z.object({ a: z.number(), b: z.number() }),
        output: z.object({ result: z.number() }),
        execute({ a, b }) {
          return Promise.resolve({ result: a + b });
        },
      }),
    );
    const runtime = createToolRuntime({ resolver: createDefaultToolResolver(registry) });
    const result = await runtime.execute(request('math.add', { a: 2, b: 3 }));
    expect(result.status).toBe('success');
    expect(typeof result.toolCallId).toBe('string');
    expect(result.status === 'success' && result.data).toEqual({ result: 5 });
  });

  it('rejects a call to an unregistered tool as TOOL_NOT_FOUND, without executing anything', async () => {
    const registry = createToolRegistry();
    const runtime = createToolRuntime({ resolver: createDefaultToolResolver(registry) });
    const result = await runtime.execute(request('nope.missing', {}));
    expect(result.status).toBe('error');
    expect(result.status === 'error' && result.error.code).toBe('TOOL_NOT_FOUND');
  });

  it('rejects a call to a disabled tool as TOOL_DISABLED (when the resolver still surfaces it)', async () => {
    // createDefaultToolResolver deliberately filters disabled tools out entirely for
    // discovery (Section 20) - TOOL_DISABLED is the runtime's own defense-in-depth check for
    // a resolver that still surfaces a disabled tool (e.g. one that was enabled when
    // offered to the model but disabled by the time the call arrived).
    const offTool = defineTool({
      name: 'off.tool',
      description: 'x',
      input: z.object({}),
      enabled: false,
      execute() {
        return Promise.resolve(undefined);
      },
    });
    const runtime = createToolRuntime({ resolver: createStaticToolResolver([offTool]) });
    const result = await runtime.execute(request('off.tool', {}));
    expect(result.status).toBe('error');
    expect(result.status === 'error' && result.error.code).toBe('TOOL_DISABLED');
  });

  it('never executes the tool body when arguments fail schema validation', async () => {
    const execute = vi.fn().mockResolvedValue({ result: 0 });
    const registry = createToolRegistry();
    registry.register(
      defineTool({
        name: 'math.add',
        description: 'x',
        input: z.object({ a: z.number(), b: z.number() }),
        execute,
      }),
    );
    const runtime = createToolRuntime({ resolver: createDefaultToolResolver(registry) });
    const result = await runtime.execute(request('math.add', { a: 'not-a-number', b: 2 }));
    expect(result.status).toBe('error');
    expect(result.status === 'error' && result.error.code).toBe('VALIDATION_ERROR');
    expect(execute).not.toHaveBeenCalled();
  });

  it('rejects output that fails the declared output schema as TOOL_OUTPUT_INVALID', async () => {
    const registry = createToolRegistry();
    registry.register(
      defineTool({
        name: 'bad.output',
        description: 'x',
        input: z.object({}),
        output: z.object({ result: z.number() }),
        execute() {
          return Promise.resolve({ result: 'not-a-number' } as unknown as { result: number });
        },
      }),
    );
    const runtime = createToolRuntime({ resolver: createDefaultToolResolver(registry) });
    const result = await runtime.execute(request('bad.output', {}));
    expect(result.status).toBe('error');
    expect(result.status === 'error' && result.error.code).toBe('TOOL_OUTPUT_INVALID');
  });

  it('normalizes a thrown error from the tool body into TOOL_EXECUTION_ERROR', async () => {
    const registry = createToolRegistry();
    registry.register(
      defineTool({
        name: 'throws',
        description: 'x',
        input: z.object({}),
        execute() {
          throw new Error('downstream service unavailable');
        },
      }),
    );
    const runtime = createToolRuntime({ resolver: createDefaultToolResolver(registry) });
    const result = await runtime.execute(request('throws', {}));
    expect(result.status).toBe('error');
    expect(result.status === 'error' && result.error.code).toBe('TOOL_EXECUTION_ERROR');
    expect(result.status === 'error' && result.error.message).toContain(
      'downstream service unavailable',
    );
  });

  it('enforces a per-tool timeout', async () => {
    const registry = createToolRegistry();
    registry.register(
      defineTool({
        name: 'slow',
        description: 'x',
        input: z.object({}),
        metadata: { timeoutMs: 10 },
        execute() {
          return new Promise(() => {
            /* never resolves */
          });
        },
      }),
    );
    const runtime = createToolRuntime({ resolver: createDefaultToolResolver(registry) });
    const result = await runtime.execute(request('slow', {}));
    expect(result.status).toBe('error');
    expect(result.status === 'error' && result.error.code).toBe('TIMEOUT');
  });

  it('cancels via the execution context signal, reporting CANCELLED', async () => {
    const registry = createToolRegistry();
    registry.register(
      defineTool({
        name: 'slow',
        description: 'x',
        input: z.object({}),
        execute() {
          return new Promise(() => {
            /* never resolves */
          });
        },
      }),
    );
    const runtime = createToolRuntime({ resolver: createDefaultToolResolver(registry) });
    const controller = new AbortController();
    const pending = runtime.execute(request('slow', {}, { context: context(controller.signal) }));
    controller.abort();
    const result = await pending;
    expect(result.status).toBe('error');
    expect(result.status === 'error' && result.error.code).toBe('CANCELLED');
  });

  it('emits started/completed lifecycle notifications for a successful call, and never a stray tool.completed after cancellation', async () => {
    const events: string[] = [];
    const registry = createToolRegistry();
    registry.register(
      defineTool({
        name: 'math.add',
        description: 'x',
        input: z.object({ a: z.number(), b: z.number() }),
        execute({ a, b }) {
          return Promise.resolve({ result: a + b });
        },
      }),
    );
    const runtime = createToolRuntime({
      resolver: createDefaultToolResolver(registry),
      onEvent: (event) => events.push(event.phase),
    });
    await runtime.execute(request('math.add', { a: 1, b: 1 }));
    expect(events).toEqual(['started', 'completed']);
  });

  it('emits started/failed for a call that throws', async () => {
    const events: string[] = [];
    const registry = createToolRegistry();
    registry.register(
      defineTool({
        name: 'throws',
        description: 'x',
        input: z.object({}),
        execute() {
          throw new Error('boom');
        },
      }),
    );
    const runtime = createToolRuntime({
      resolver: createDefaultToolResolver(registry),
      onEvent: (event) => events.push(event.phase),
    });
    await runtime.execute(request('throws', {}));
    expect(events).toEqual(['started', 'failed']);
  });

  it('applies middleware in the declared order around the core executor', async () => {
    const order: string[] = [];
    const registry = createToolRegistry();
    registry.register(
      defineTool({
        name: 'math.add',
        description: 'x',
        input: z.object({ a: z.number(), b: z.number() }),
        execute({ a, b }) {
          order.push('execute');
          return Promise.resolve({ result: a + b });
        },
      }),
    );
    const runtime = createToolRuntime({
      resolver: createDefaultToolResolver(registry),
      middleware: [
        async (_invocation, next) => {
          order.push('outer-before');
          const result = await next();
          order.push('outer-after');
          return result;
        },
        async (_invocation, next) => {
          order.push('inner-before');
          const result = await next();
          order.push('inner-after');
          return result;
        },
      ],
    });
    await runtime.execute(request('math.add', { a: 1, b: 1 }));
    expect(order).toEqual([
      'outer-before',
      'inner-before',
      'execute',
      'inner-after',
      'outer-after',
    ]);
  });

  it('truncates an oversized result according to resultSerialization.maxResultBytes', async () => {
    const registry = createToolRegistry();
    registry.register(
      defineTool({
        name: 'big',
        description: 'x',
        input: z.object({}),
        execute() {
          return Promise.resolve({ blob: 'x'.repeat(1000) });
        },
      }),
    );
    const runtime = createToolRuntime({
      resolver: createDefaultToolResolver(registry),
      resultSerialization: { maxResultBytes: 50 },
    });
    const result = await runtime.execute(request('big', {}));
    expect(result.status).toBe('success');
    expect(
      result.status === 'success' &&
        typeof result.data === 'object' &&
        result.data !== null &&
        'truncated' in result.data &&
        (result.data as { truncated: boolean }).truncated,
    ).toBe(true);
  });
});
