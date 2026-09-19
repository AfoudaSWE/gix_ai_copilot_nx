import { CopilotError } from '@gixcopilot/protocol';
import type {
  ContentPart,
  ThreadId,
  ToolCall,
  ToolManifestEntry,
  ToolResult,
} from '@gixcopilot/protocol';
import type { Executor, ExecutorContext, ExecutorInput } from '@gixcopilot/core';
import {
  createToolRuntime,
  runWithConcurrencyPlan,
  toToolManifest,
} from '@gixcopilot/tools';
import type { AnyToolDefinition, ToolResolver } from '@gixcopilot/tools';
import type { ModelMessage, ModelReference, ModelRuntime, ModelToolDefinition } from '@gixcopilot/provider';
import type { FrontendToolBridge } from './frontend-tool-bridge.js';

export interface CreateToolCallingExecutorOptions {
  readonly modelRuntime: ModelRuntime;
  readonly model?: ModelReference;
  /** Discovery boundary for backend tools (Section 65-66) - see `@gixcopilot/tools`. */
  readonly backendToolResolver: ToolResolver;
  /** Per-run, client-declared frontend tool manifest (Section 45-46) - wire-safe, no Zod
   * schemas (those never leave the browser). Empty when the client registered none. */
  readonly frontendTools: readonly ToolManifestEntry[];
  readonly frontendToolBridge: FrontendToolBridge;
  /** Hard cap on Model -> Tool -> Model rounds within a single run (Section 40). */
  readonly maxToolIterations?: number;
  /** How long the server waits for a frontend tool result before FRONTEND_TOOL_UNAVAILABLE
   * (Section 51). Omit for no timeout (bounded only by run cancellation). */
  readonly frontendToolTimeoutMs?: number;
  readonly toolTimeoutMs?: number;
  readonly temperature?: number;
  readonly maxOutputTokens?: number;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly timeoutMs?: number;
}

const DEFAULT_MAX_TOOL_ITERATIONS = 8;

function toModelToolDefinitions(
  manifest: readonly ToolManifestEntry[],
): readonly ModelToolDefinition[] {
  return manifest.map((entry) => ({
    name: entry.name,
    description: entry.description,
    parameters: entry.parameters,
  }));
}

function assistantToolCallMessage(toolCalls: readonly ToolCall[]): ModelMessage {
  const content: ContentPart[] = toolCalls.map((call) => ({
    type: 'tool_call',
    toolCallId: call.id,
    name: call.name,
    arguments: call.arguments,
  }));
  return { role: 'assistant', content };
}

function toolResultMessage(result: ToolResult): ModelMessage {
  return {
    role: 'tool',
    content: [{ type: 'tool_result', toolCallId: result.toolCallId, result }],
  };
}

/**
 * The Model -> Tool -> Model loop (Section 39, 101), implemented as a single `Executor.execute()`
 * call - `@gixcopilot/core`'s runtime and protocol never need to know a tool-calling round
 * trip happened at all; they only see text deltas and, via `ExecutorContext.onToolEvent`
 * (Phase 5's additive extension point - see `@gixcopilot/core`'s executor.ts), tool
 * lifecycle notifications interleaved with them. Backend tool calls execute in-process via
 * `@gixcopilot/tools`' ToolRuntime; frontend tool calls suspend on `frontendToolBridge`
 * until the client posts a result back (Section 45) - see docs/phases/phase-05/
 * Phase_5_Architecture.md for the full diagram.
 */
export function createToolCallingExecutor(options: CreateToolCallingExecutorOptions): Executor {
  const maxToolIterations = options.maxToolIterations ?? DEFAULT_MAX_TOOL_ITERATIONS;

  return {
    async *execute(input: ExecutorInput, context: ExecutorContext) {
      const toolRuntime = createToolRuntime({
        resolver: options.backendToolResolver,
        defaultTimeoutMs: options.toolTimeoutMs,
        onEvent: (event) => {
          context.onToolEvent?.(event);
        },
      });

      let messages: ModelMessage[] = input.messages.map(({ role, content }) => ({
        role,
        content,
      }));
      let iterations = 0;

      while (true) {
        const backendTools = await options.backendToolResolver.resolve({
          runId: context.runId,
          threadId: input.threadId,
        });
        const manifest: readonly ToolManifestEntry[] = [
          ...toToolManifest(backendTools),
          ...options.frontendTools,
        ];

        let usage;
        let finishReason;
        const toolCallsThisTurn: ToolCall[] = [];

        for await (const event of options.modelRuntime.stream({
          model: options.model,
          messages,
          temperature: options.temperature,
          maxOutputTokens: options.maxOutputTokens,
          metadata: options.metadata,
          timeoutMs: options.timeoutMs,
          signal: context.signal,
          tools: manifest.length > 0 ? toModelToolDefinitions(manifest) : undefined,
        })) {
          switch (event.type) {
            case 'model.started':
              break;
            case 'content.delta':
              yield event.delta;
              break;
            case 'usage.updated':
              usage = event.usage;
              break;
            case 'tool_call.requested':
              toolCallsThisTurn.push(event.toolCall);
              break;
            case 'model.completed':
              finishReason = event.finishReason;
              usage = event.usage ?? usage;
              break;
            case 'model.failed':
              throw new CopilotError(event.error.code, event.error.message, {
                retryable: event.error.retryable,
                metadata: event.error.metadata,
              });
            default: {
              const exhaustive: never = event;
              throw new Error(`Unhandled model stream event: ${JSON.stringify(exhaustive)}`);
            }
          }
        }

        if (toolCallsThisTurn.length === 0) {
          return { usage, finishReason };
        }

        iterations += 1;
        if (iterations > maxToolIterations) {
          throw CopilotError.toolIterationLimitExceeded(maxToolIterations);
        }

        messages = [...messages, assistantToolCallMessage(toolCallsThisTurn)];

        // Announce every call before executing any of them, then yield a no-op text delta
        // ('' - never accumulated, never visible to the model) purely to hand control back
        // to @gixcopilot/core's runtime so it drains and flushes these `requested` events
        // over SSE *now*. This is not cosmetic: a frontend call's dispatch below suspends on
        // `frontendToolBridge.awaitResult()`, and the client can only submit a result for a
        // call it has actually received - without this flush point, the event and the wait
        // for its response would deadlock inside the same unresolved `execute()` step.
        const frontendNames = new Set(options.frontendTools.map((entry) => entry.name));
        for (const call of toolCallsThisTurn) {
          context.onToolEvent?.({
            phase: 'requested',
            toolCallId: call.id,
            name: call.name,
            arguments: call.arguments,
            source: frontendNames.has(call.name) ? 'frontend' : 'native',
          });
        }
        yield '';

        const results = await dispatchToolCalls(toolCallsThisTurn, {
          backendTools,
          frontendManifest: options.frontendTools,
          toolRuntime,
          frontendToolBridge: options.frontendToolBridge,
          context,
          threadId: input.threadId,
          frontendToolTimeoutMs: options.frontendToolTimeoutMs,
        });

        for (const result of results) {
          messages = [...messages, toolResultMessage(result)];
        }
      }
    },
  };
}

interface DispatchOptions {
  readonly backendTools: readonly AnyToolDefinition[];
  readonly frontendManifest: readonly ToolManifestEntry[];
  readonly toolRuntime: ReturnType<typeof createToolRuntime>;
  readonly frontendToolBridge: FrontendToolBridge;
  readonly context: ExecutorContext;
  readonly threadId: ThreadId | undefined;
  readonly frontendToolTimeoutMs?: number;
}

async function dispatchToolCalls(
  toolCalls: readonly ToolCall[],
  options: DispatchOptions,
): Promise<readonly ToolResult[]> {
  return runWithConcurrencyPlan(
    toolCalls,
    (call) => options.backendTools.find((tool) => tool.name === call.name)?.metadata?.concurrency,
    (call) => dispatchOne(call, options),
  );
}

async function dispatchOne(call: ToolCall, options: DispatchOptions): Promise<ToolResult> {
  const isFrontend = options.frontendManifest.some((entry) => entry.name === call.name);

  if (isFrontend) {
    options.context.onToolEvent?.({ phase: 'started', toolCallId: call.id, name: call.name });
    const result = await options.frontendToolBridge.awaitResult(
      options.context.runId,
      call.id,
      call.name,
      { signal: options.context.signal, timeoutMs: options.frontendToolTimeoutMs },
    );
    if (result.status === 'success') {
      options.context.onToolEvent?.({
        phase: 'completed',
        toolCallId: call.id,
        name: call.name,
        result: result.data,
      });
    } else {
      options.context.onToolEvent?.({
        phase: 'failed',
        toolCallId: call.id,
        name: call.name,
        error: result.error,
      });
    }
    return result;
  }

  return options.toolRuntime.execute({
    toolCallId: call.id,
    name: call.name,
    arguments: call.arguments,
    context: {
      runId: options.context.runId,
      threadId: options.threadId,
      signal: options.context.signal,
    },
  });
}
