import type { CopilotErrorCode, FinishReason, PublicCopilotError, Usage } from '@gixcopilot/protocol';
import type { ModelExecutionOptions, ModelProvider, ModelRequest, ModelStreamEvent } from '@gixcopilot/provider';

/** A simulated provider failure (Section 75) - mapped onto the normalized error codes real
 * provider adapters use, so retry/fallback logic sees exactly what production would. */
export type SimulatedFailure = 'timeout' | 'rate-limit' | 'server-error' | 'network' | 'context-limit' | 'authentication';

const FAILURES: Record<SimulatedFailure, { readonly code: CopilotErrorCode; readonly message: string; readonly retryable: boolean }> = {
  timeout: { code: 'TIMEOUT', message: 'Simulated provider timeout.', retryable: true },
  'rate-limit': { code: 'RATE_LIMITED', message: 'Simulated HTTP 429 rate limit.', retryable: true },
  'server-error': { code: 'PROVIDER_ERROR', message: 'Simulated HTTP 500 provider error.', retryable: true },
  network: { code: 'NETWORK_ERROR', message: 'Simulated network failure.', retryable: true },
  'context-limit': { code: 'CONTEXT_LIMIT_EXCEEDED', message: 'Simulated context limit.', retryable: false },
  authentication: { code: 'AUTHENTICATION_ERROR', message: 'Simulated invalid credentials.', retryable: false },
};

export interface TestToolCall {
  readonly name: string;
  readonly arguments?: Readonly<Record<string, unknown>>;
  readonly id?: string;
}

/** One scripted model turn (Section 73-75). Exactly the events a real provider streams. */
export type TestModelResponse =
  | { readonly text: string | readonly string[]; readonly usage?: Usage; readonly delayMsPerChunk?: number; readonly finishReason?: FinishReason }
  | { readonly toolCalls: readonly TestToolCall[]; readonly text?: string; readonly usage?: Usage }
  /** Structured output: streamed as JSON text, exactly what `generateObject` consumes. */
  | { readonly object: unknown; readonly usage?: Usage }
  /** Invalid structured output - text that is not the JSON the caller's schema expects. */
  | { readonly malformed: string }
  | { readonly fail: SimulatedFailure }
  /** Streams some chunks, then the connection drops mid-stream. */
  | { readonly interruptAfter: number; readonly text: readonly string[] }
  /** Streams slowly until the caller aborts - for cancellation tests. */
  | { readonly hang: true; readonly chunkEveryMs?: number };

/** What a `when` predicate sees - the real request plus convenience views of it. */
export interface TestModelTurn {
  readonly request: ModelRequest;
  /** 1-based index of this call to this model. */
  readonly callIndex: number;
  readonly lastUserText: string;
  /** Names of tools whose results are already in the conversation. */
  readonly toolResults: readonly string[];
  readonly availableTools: readonly string[];
}

export interface TestModelRule {
  readonly when?: (turn: TestModelTurn) => boolean;
  readonly respond: TestModelResponse | ((turn: TestModelTurn) => TestModelResponse);
  /** Use this rule at most this many times, then fall through to later rules. */
  readonly times?: number;
}

export interface TestModel extends ModelProvider {
  /** Every request this model received, in order - for assertions on prompts/tools sent. */
  readonly requests: readonly ModelRequest[];
  reset(): void;
}

export interface CreateTestModelOptions {
  readonly id?: string;
  /** Used when no rule matches (default: a short text answer). */
  readonly fallback?: TestModelResponse;
  /** Deterministic usage reported when a response doesn't set its own. */
  readonly defaultUsage?: Usage;
}

function textOf(parts: ModelRequest['messages'][number]['content']): string {
  return parts.map((part) => (part.type === 'text' ? part.text : '')).join('');
}

function turnOf(request: ModelRequest, callIndex: number): TestModelTurn {
  const lastUser = [...request.messages].reverse().find((message) => message.role === 'user');
  // A tool result only carries its call id - resolve the tool name from the matching call.
  const callNames = new Map<string, string>();
  for (const message of request.messages) {
    for (const part of message.content) if (part.type === 'tool_call') callNames.set(part.toolCallId, part.name);
  }
  const toolResults = request.messages.flatMap((message) =>
    message.content.flatMap((part) => (part.type === 'tool_result' ? [callNames.get(part.toolCallId) ?? part.toolCallId] : [])),
  );
  return {
    request,
    callIndex,
    lastUserText: lastUser ? textOf(lastUser.content) : '',
    toolResults,
    availableTools: (request.tools ?? []).map((tool) => tool.name),
  };
}

function isAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

function wait(ms: number, signal: AbortSignal | undefined): Promise<void> {
  if (ms <= 0 || isAborted(signal)) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}

function failure(kind: SimulatedFailure): PublicCopilotError {
  return { ...FAILURES[kind] };
}

/**
 * A deterministic, request-aware `ModelProvider` (Section 73-75, 187): rules match on the
 * actual request (last user message, tool results already present, tools offered) instead of
 * a blind call counter, so a test states "when the user asks X, call tool Y; once Y's result
 * is in, answer Z" - and the real runtime drives the loop. Never touches the network.
 */
export function createTestModel(rules: readonly TestModelRule[], options: CreateTestModelOptions = {}): TestModel {
  const requests: ModelRequest[] = [];
  const uses = new Map<TestModelRule, number>();
  const defaultUsage = options.defaultUsage ?? { inputTokens: 10, outputTokens: 5, totalTokens: 15 };
  let toolCallCounter = 0;

  function pick(turn: TestModelTurn): TestModelResponse {
    for (const rule of rules) {
      const used = uses.get(rule) ?? 0;
      if (rule.times !== undefined && used >= rule.times) continue;
      if (rule.when && !rule.when(turn)) continue;
      uses.set(rule, used + 1);
      return typeof rule.respond === 'function' ? rule.respond(turn) : rule.respond;
    }
    return options.fallback ?? { text: 'OK.' };
  }

  async function* stream(request: ModelRequest, execution?: ModelExecutionOptions): AsyncGenerator<ModelStreamEvent, void, undefined> {
    requests.push(request);
    const signal = execution?.signal;
    const response = pick(turnOf(request, requests.length));
    yield { type: 'model.started' };
    if (isAborted(signal)) return;

    if ('fail' in response) {
      yield { type: 'model.failed', error: failure(response.fail) };
      return;
    }
    if ('hang' in response) {
      while (!isAborted(signal)) {
        yield { type: 'content.delta', delta: '.' };
        await wait(response.chunkEveryMs ?? 10, signal);
      }
      return;
    }
    if ('interruptAfter' in response) {
      for (const [index, chunk] of response.text.entries()) {
        if (index >= response.interruptAfter) break;
        yield { type: 'content.delta', delta: chunk };
      }
      yield { type: 'model.failed', error: { code: 'NETWORK_ERROR', message: 'Simulated stream interruption.', retryable: true } };
      return;
    }
    if ('malformed' in response) {
      yield { type: 'content.delta', delta: response.malformed };
      yield { type: 'model.completed', finishReason: 'stop', usage: defaultUsage };
      return;
    }
    if ('object' in response) {
      yield { type: 'content.delta', delta: JSON.stringify(response.object) };
      yield { type: 'model.completed', finishReason: 'stop', usage: response.usage ?? defaultUsage };
      return;
    }
    if ('toolCalls' in response) {
      if (response.text) yield { type: 'content.delta', delta: response.text };
      for (const call of response.toolCalls) {
        if (isAborted(signal)) return;
        toolCallCounter += 1;
        yield { type: 'tool_call.requested', toolCall: { id: call.id ?? `test-call-${toolCallCounter}`, name: call.name, arguments: call.arguments ?? {} } };
      }
      yield { type: 'model.completed', finishReason: 'tool_calls', usage: response.usage ?? defaultUsage };
      return;
    }
    const chunks = typeof response.text === 'string' ? [response.text] : response.text;
    for (const chunk of chunks) {
      if (isAborted(signal)) return;
      yield { type: 'content.delta', delta: chunk };
      await wait(response.delayMsPerChunk ?? 0, signal);
    }
    if (isAborted(signal)) return;
    yield { type: 'model.completed', finishReason: response.finishReason ?? 'stop', usage: response.usage ?? defaultUsage };
  }

  return {
    id: options.id ?? 'test',
    requests,
    stream,
    reset() {
      requests.length = 0;
      uses.clear();
      toolCallCounter = 0;
    },
  };
}

/** Convenience: answer with tool calls first, then with `answer` once every tool's result is back. */
export function toolThenAnswer(toolCalls: readonly TestToolCall[], answer: string): TestModelRule[] {
  const names = toolCalls.map((call) => call.name);
  return [
    { when: (turn) => names.every((name) => turn.toolResults.includes(name)), respond: { text: answer } },
    { when: (turn) => !names.every((name) => turn.toolResults.includes(name)), respond: { toolCalls } },
  ];
}
