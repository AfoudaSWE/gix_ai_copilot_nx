import { describe, expect, it } from 'vitest';
import { createModelRuntime } from '@gixcopilot/provider';
import { createOpenAIProvider } from '@gixcopilot/provider-openai';
import type { ModelStreamEvent } from '@gixcopilot/provider';

/**
 * Section 53's optional real-provider smoke test. Only runs when OPENAI_API_KEY is set in
 * the environment; otherwise it is SKIPPED, never FAILED, and is never part of the
 * deterministic CI requirement (see `pnpm test` / Phase_2_Testing.md) - this file makes a
 * real network call to OpenAI's API and costs real (tiny) money when it does run.
 *
 * Run explicitly with:
 *   OPENAI_API_KEY=sk-... pnpm --filter @gixcopilot/model-streaming-demo test -- openai-smoke
 */
const apiKey = process.env['OPENAI_API_KEY'];

describe.skipIf(!apiKey)(
  'OpenAI provider smoke test (requires OPENAI_API_KEY, real network call)',
  () => {
    it('streams a real completion from OpenAI and reports usage and a stop finish reason', async () => {
      const provider = createOpenAIProvider({ apiKey });
      const runtime = createModelRuntime({ providers: [provider] });

      const events: ModelStreamEvent[] = [];
      for await (const event of runtime.stream({
        model: { provider: 'openai', model: process.env['OPENAI_SMOKE_MODEL'] ?? 'gpt-4o-mini' },
        messages: [
          {
            role: 'user',
            content: [{ type: 'text', text: 'Reply with exactly the word: pong' }],
          },
        ],
        timeoutMs: 30_000,
      })) {
        events.push(event);
      }

      const deltas = events.filter((event) => event.type === 'content.delta');
      expect(deltas.length).toBeGreaterThan(0);

      const completed = events.find((event) => event.type === 'model.completed');
      expect(completed).toBeDefined();
      expect(completed?.type === 'model.completed' && completed.finishReason).toBe('stop');
    }, 30_000);
  },
);

if (!apiKey) {
  console.log('[openai-smoke] SKIPPED: OPENAI_API_KEY is not set.');
}
