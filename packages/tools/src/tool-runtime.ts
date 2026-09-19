import { CopilotError } from '@gixcopilot/protocol';
import type { PublicCopilotError, ToolCallId, ToolResult } from '@gixcopilot/protocol';
import { isToolEnabled } from './tool-definition.js';
import type { AnyToolDefinition, ToolExecutionContext } from './tool-definition.js';
import { serializeToolResult } from './tool-result-serialization.js';
import type { SerializeToolResultOptions } from './tool-result-serialization.js';
import type { ToolResolutionContext, ToolResolver } from './tool-resolver.js';

/** One tool call awaiting execution (Section 24, 30). `arguments` is not yet validated. */
export interface ToolInvocationRequest {
  readonly toolCallId: ToolCallId;
  readonly name: string;
  readonly arguments: unknown;
  readonly context: ToolExecutionContext;
}

/**
 * The execution pipeline boundary (Section 31) a future Phase 7 Action Firewall plugs into.
 * `next()` continues to the next middleware, or to the tool's own validated `execute()` once
 * every middleware has run - the same onion model as Fastify/Express middleware, chosen
 * because it is already a familiar pattern to this codebase's own server package. No
 * security middleware (auth/RBAC/ABAC/approval/audit) is implemented here in Phase 5 - see
 * docs/phases/phase-05/Phase_5_Architecture.md's "Future Action Firewall Checkpoint".
 */
export type ToolRuntimeMiddleware = (
  invocation: ToolInvocationRequest,
  next: () => Promise<ToolResult>,
) => Promise<ToolResult>;

export interface CreateToolRuntimeOptions {
  readonly resolver: ToolResolver;
  readonly middleware?: readonly ToolRuntimeMiddleware[];
  /** Applied when a tool declares no `metadata.timeoutMs` of its own. Omit for no default
   * timeout (a tool with neither still respects `context.signal`). */
  readonly defaultTimeoutMs?: number;
  readonly resultSerialization?: SerializeToolResultOptions;
  /** Started/completed/failed lifecycle notifications (Section 32-33). The `requested`
   * phase is the caller's responsibility - see the module doc comment. */
  readonly onEvent?: (
    event:
      | { readonly phase: 'started'; readonly toolCallId: ToolCallId; readonly name: string }
      | {
          readonly phase: 'completed';
          readonly toolCallId: ToolCallId;
          readonly name: string;
          readonly result: unknown;
        }
      | {
          readonly phase: 'failed';
          readonly toolCallId: ToolCallId;
          readonly name: string;
          readonly error: PublicCopilotError;
        },
  ) => void;
}

export interface ToolRuntime {
  execute(request: ToolInvocationRequest): Promise<ToolResult>;
}

class ToolTimeoutSignal extends Error {
  constructor() {
    super('Tool execution deadline exceeded.');
  }
}
class ToolAbortedSignal extends Error {
  constructor() {
    super('Tool execution was aborted.');
  }
}

async function raceWithDeadline<T>(
  work: Promise<T>,
  signal: AbortSignal,
  timeoutMs: number | undefined,
): Promise<T> {
  if (signal.aborted) {
    throw new ToolAbortedSignal();
  }
  return new Promise<T>((resolve, reject) => {
    const timer =
      timeoutMs !== undefined
        ? setTimeout(() => {
            cleanup();
            reject(new ToolTimeoutSignal());
          }, timeoutMs)
        : undefined;

    function onAbort(): void {
      cleanup();
      reject(new ToolAbortedSignal());
    }
    function cleanup(): void {
      if (timer !== undefined) clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
    }

    signal.addEventListener('abort', onAbort, { once: true });
    work.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error: unknown) => {
        cleanup();
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

function composeMiddleware(
  middleware: readonly ToolRuntimeMiddleware[],
  core: (invocation: ToolInvocationRequest) => Promise<ToolResult>,
): (invocation: ToolInvocationRequest) => Promise<ToolResult> {
  return middleware.reduceRight<(invocation: ToolInvocationRequest) => Promise<ToolResult>>(
    (next, layer) => (invocation) => layer(invocation, () => next(invocation)),
    core,
  );
}

async function resolveTool(
  resolver: ToolResolver,
  context: ToolResolutionContext,
  name: string,
): Promise<AnyToolDefinition | undefined> {
  const tools = await resolver.resolve(context);
  return tools.find((tool) => tool.name === name);
}

/**
 * The framework-independent tool execution runtime (Section 30): resolve -> validate input
 * -> middleware -> timeout/cancellation -> execute -> validate output -> normalize
 * result/error -> lifecycle events. Never throws - every failure mode becomes a `ToolResult`
 * with `status: 'error'`, so a caller (e.g. a server's tool-calling executor) always has a
 * value to feed back to the model, never an exception to handle separately.
 */
export function createToolRuntime(options: CreateToolRuntimeOptions): ToolRuntime {
  const middleware = options.middleware ?? [];

  async function coreExecute(invocation: ToolInvocationRequest): Promise<ToolResult> {
    const { toolCallId, name, context } = invocation;
    if (context.signal.aborted) {
      return { status: 'error', toolCallId, error: CopilotError.cancelled().toPublicJSON() };
    }

    const tool = await resolveTool(
      options.resolver,
      { runId: context.runId, threadId: context.threadId },
      name,
    );
    if (!tool) {
      return { status: 'error', toolCallId, error: CopilotError.toolNotFound(name).toPublicJSON() };
    }
    if (!isToolEnabled(tool)) {
      return { status: 'error', toolCallId, error: CopilotError.toolDisabled(name).toPublicJSON() };
    }

    const parsedInput = tool.inputSchema.safeParse(invocation.arguments);
    if (!parsedInput.success) {
      const error = CopilotError.validation(`Invalid arguments for tool "${name}".`, {
        name,
        issueCount: parsedInput.error.issues.length,
      });
      return { status: 'error', toolCallId, error: error.toPublicJSON() };
    }

    options.onEvent?.({ phase: 'started', toolCallId, name });

    const timeoutMs = tool.metadata?.timeoutMs ?? options.defaultTimeoutMs;
    let rawOutput: unknown;
    try {
      if (context.signal.aborted) throw new ToolAbortedSignal();
      rawOutput = await raceWithDeadline(
        tool.execute(parsedInput.data, context),
        context.signal,
        timeoutMs,
      );
    } catch (caught) {
      const error =
        caught instanceof ToolTimeoutSignal
          ? CopilotError.timeout(`Tool "${name}" timed out after ${String(timeoutMs)}ms.`)
          : caught instanceof ToolAbortedSignal
            ? CopilotError.cancelled(`Tool "${name}" was cancelled.`)
            : CopilotError.toolExecutionError(
                caught instanceof Error ? caught.message : `Tool "${name}" failed to execute.`,
                { name },
              );
      options.onEvent?.({ phase: 'failed', toolCallId, name, error: error.toPublicJSON() });
      return { status: 'error', toolCallId, error: error.toPublicJSON() };
    }

    if (tool.outputSchema) {
      const parsedOutput = tool.outputSchema.safeParse(rawOutput);
      if (!parsedOutput.success) {
        const error = CopilotError.toolOutputInvalid(
          `Tool "${name}" produced output that does not match its declared output schema.`,
          { name, issueCount: parsedOutput.error.issues.length },
        );
        options.onEvent?.({ phase: 'failed', toolCallId, name, error: error.toPublicJSON() });
        return { status: 'error', toolCallId, error: error.toPublicJSON() };
      }
      rawOutput = parsedOutput.data;
    }

    const serialized = serializeToolResult(rawOutput, options.resultSerialization);
    options.onEvent?.({ phase: 'completed', toolCallId, name, result: serialized.value });
    return { status: 'success', toolCallId, data: serialized.value };
  }

  const pipeline = composeMiddleware(middleware, coreExecute);

  return {
    execute: (request) => pipeline(request),
  };
}
