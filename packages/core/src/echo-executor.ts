import type { Executor, ExecutorContext, ExecutorInput } from './executor.js';

export interface EchoExecutorOptions {
  /**
   * Artificial delay between chunks, in milliseconds. Defaults to 0 so tests stay
   * deterministic and instant (see the testing skill's "no sleep-dependent tests" rule);
   * the protocol-demo example sets this above 0 purely so a human watching the CLI can see
   * the stream arrive incrementally.
   */
  readonly delayMsPerChunk?: number;
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0 || signal.aborted) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

function extractInputText(input: ExecutorInput): string {
  const lastMessage = input.messages.at(-1);
  if (!lastMessage) {
    return '';
  }
  return lastMessage.content
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('');
}

/**
 * A deterministic, non-AI reference Executor used to prove the Phase 1 architecture (see
 * docs/architecture/overview.md) and to exercise @aicopilot/core's runtime in tests without
 * any network call or provider dependency. It echoes its input back as a sequence of word /
 * whitespace chunks - e.g. "Hello protocol" -> "Hello", " ", "protocol".
 *
 * This is explicitly NOT a stand-in for an LLM and must not be used as a template for one;
 * Phase 2 introduces the actual model-provider abstraction in the ai-runtime skill.
 */
export function createEchoExecutor(options: EchoExecutorOptions = {}): Executor {
  const delayMsPerChunk = options.delayMsPerChunk ?? 0;

  return {
    async *execute(input: ExecutorInput, context: ExecutorContext) {
      const text = extractInputText(input);
      const chunks = text.match(/\S+|\s+/g) ?? [];

      for (const chunk of chunks) {
        if (context.signal.aborted) {
          return;
        }
        yield chunk;
        await delay(delayMsPerChunk, context.signal);
      }
    },
  };
}
