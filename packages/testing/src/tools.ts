import { z } from 'zod';
import { CopilotError } from '@gixcopilot/protocol';
import type { CopilotErrorCode, ToolSecurityManifest } from '@gixcopilot/protocol';
import { defineTool } from '@gixcopilot/tools';
import type { AnyToolDefinition, ToolExecutionContext } from '@gixcopilot/tools';
import { fail } from './assert.js';

export interface ToolCallRecord {
  readonly name: string;
  readonly arguments: Readonly<Record<string, unknown>>;
  /** Global, 1-based order across every mock in the same `ToolMocks` (by invocation). */
  readonly order: number;
  readonly runId: string;
  /** `pending` while still executing - e.g. after the runtime already gave up on a timeout. */
  readonly outcome: 'pending' | 'succeeded' | 'failed' | 'cancelled';
}

export interface MockToolBehavior {
  /** A fixed result, or one computed from the arguments. */
  readonly result?: unknown;
  readonly respond?: (args: Readonly<Record<string, unknown>>, callIndex: number) => unknown;
  /** Makes the tool fail with this normalized error. */
  readonly error?: { readonly code: CopilotErrorCode; readonly message: string; readonly retryable?: boolean };
  /** Resolves after this long (respecting cancellation) - pair with a tool timeout to test one. */
  readonly delayMs?: number;
  /** Never resolves until the call is aborted - simulates a hung dependency. */
  readonly hang?: boolean;
  readonly description?: string;
  readonly input?: z.ZodType<Readonly<Record<string, unknown>>>;
  /** Real Phase 7 security metadata, so the firewall treats the mock like the real tool. */
  readonly security?: ToolSecurityManifest;
}

export interface ToolMocks {
  /** Registers (or replaces) a mock and returns its real `ToolDefinition`. */
  mock(name: string, behavior?: MockToolBehavior): AnyToolDefinition;
  readonly tools: readonly AnyToolDefinition[];
  readonly calls: readonly ToolCallRecord[];
  callsTo(name: string): readonly ToolCallRecord[];
  reset(): void;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(CopilotError.cancelled());
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(CopilotError.cancelled());
    }, { once: true });
  });
}

/**
 * Deterministic tool mocks (Section 76-77, 188). Each mock is a genuine `ToolDefinition`, so it
 * runs through the real tool runtime, schema validation and Action Firewall exactly like the
 * tool it stands in for - the only thing replaced is `execute`.
 */
export function createToolMocks(): ToolMocks {
  const tools = new Map<string, AnyToolDefinition>();
  const calls: { -readonly [K in keyof ToolCallRecord]: ToolCallRecord[K] }[] = [];

  return {
    mock(name, behavior = {}) {
      let callIndex = 0;
      const tool = defineTool({
        name,
        description: behavior.description ?? `Mock of ${name}.`,
        input: behavior.input ?? z.looseObject({}),
        security: behavior.security,
        execute: async (args: Readonly<Record<string, unknown>>, context: ToolExecutionContext) => {
          callIndex += 1;
          // Logged at invocation, so a call the runtime already abandoned (timeout) is visible.
          const call = { name, arguments: args, order: calls.length + 1, runId: context.runId, outcome: 'pending' as ToolCallRecord['outcome'] };
          calls.push(call);
          try {
            // setTimeout's maximum delay - effectively forever, until the call is aborted.
            if (behavior.hang) await sleep(2_147_483_647, context.signal);
            if (behavior.delayMs) await sleep(behavior.delayMs, context.signal);
          } catch (error) {
            call.outcome = 'cancelled';
            throw error;
          }
          if (behavior.error) {
            call.outcome = 'failed';
            throw new CopilotError(behavior.error.code, behavior.error.message, { retryable: behavior.error.retryable ?? false });
          }
          call.outcome = 'succeeded';
          return behavior.respond ? behavior.respond(args, callIndex) : (behavior.result ?? { ok: true });
        },
      }) as AnyToolDefinition;
      tools.set(name, tool);
      return tool;
    },
    get tools() {
      return [...tools.values()];
    },
    get calls() {
      return calls.map((call) => ({ ...call }));
    },
    callsTo: (name) => calls.filter((call) => call.name === name).map((call) => ({ ...call })),
    reset() {
      calls.length = 0;
    },
  };
}

/** A single standalone mock (Section 76). Prefer `createToolMocks()` to assert call order. */
export function mockTool(name: string, behavior: MockToolBehavior = {}): { readonly tool: AnyToolDefinition; readonly mocks: ToolMocks } {
  const mocks = createToolMocks();
  return { tool: mocks.mock(name, behavior), mocks };
}

function matchesSubset(actual: unknown, expected: unknown): boolean {
  if (expected === null || typeof expected !== 'object') return Object.is(actual, expected);
  if (actual === null || typeof actual !== 'object') return false;
  if (Array.isArray(expected)) {
    return Array.isArray(actual) && expected.length === actual.length && expected.every((entry, index) => matchesSubset(actual[index], entry));
  }
  return Object.entries(expected as Record<string, unknown>).every(([key, value]) => matchesSubset((actual as Record<string, unknown>)[key], value));
}

/** Asserts a tool ran (Section 77) - optionally an exact number of times, and/or at least one
 * call whose arguments contain `withArguments`. Checks behavior, not runtime internals. */
export function expectToolCalled(
  mocks: ToolMocks,
  name: string,
  options: { readonly times?: number; readonly withArguments?: Readonly<Record<string, unknown>> } = {},
): void {
  const calls = mocks.callsTo(name);
  if (calls.length === 0) fail(`Expected tool "${name}" to be called, but it was never called.`, { calls: mocks.calls });
  if (options.times !== undefined && calls.length !== options.times) {
    fail(`Expected tool "${name}" to be called ${options.times} time(s), but it was called ${calls.length} time(s).`, { calls });
  }
  if (options.withArguments && !calls.some((call) => matchesSubset(call.arguments, options.withArguments))) {
    fail(`Tool "${name}" was never called with arguments matching ${JSON.stringify(options.withArguments)}.`, { calls });
  }
}

export function expectToolNotCalled(mocks: ToolMocks, name: string): void {
  const calls = mocks.callsTo(name);
  if (calls.length > 0) fail(`Expected tool "${name}" not to be called, but it was called ${calls.length} time(s).`, { calls });
}

/** Asserts these tools ran in this relative order (other calls may be interleaved). */
export function expectToolOrder(mocks: ToolMocks, names: readonly string[]): void {
  const sequence = mocks.calls.map((call) => call.name);
  let cursor = 0;
  for (const name of sequence) if (name === names[cursor]) cursor += 1;
  if (cursor < names.length) fail(`Expected tool order ${names.join(' -> ')}, got ${sequence.join(' -> ') || '(no calls)'}.`, { sequence });
}
