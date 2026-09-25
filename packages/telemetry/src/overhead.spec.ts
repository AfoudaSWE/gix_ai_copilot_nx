import { performance } from 'node:perf_hooks';
import { expect, it } from 'vitest';
import { createNoopTelemetry } from './adapter.js';
import { instrumentModelRuntime } from './instrument/model-runtime.js';
import { createRecordingTelemetry } from './recording.js';

it('keeps disabled model telemetry off the streaming hot path', async () => {
  const runtime = {
    async *stream(_request: { messages: readonly unknown[] }) {
      await Promise.resolve();
      yield { type: 'content.delta', delta: 'x' } as const;
    },
  };
  const noop = instrumentModelRuntime(runtime, createNoopTelemetry());
  const recording = instrumentModelRuntime(runtime, createRecordingTelemetry({ capacity: 500 }));
  async function run(target: typeof runtime): Promise<number> {
    const started = performance.now();
    for (let index = 0; index < 500; index += 1) {
      for await (const _event of target.stream({ messages: [] })) {
        // Consume the stream as an application would.
      }
    }
    return performance.now() - started;
  }
  await run(runtime);
  await run(noop);
  await run(recording);
  const rawMs = await run(runtime);
  const noopMs = await run(noop);
  const recordingMs = await run(recording);
  console.info(`telemetry overhead: raw=${rawMs.toFixed(2)}ms noop=${noopMs.toFixed(2)}ms recording=${recordingMs.toFixed(2)}ms (500 streams)`);
  expect(noop).toBe(runtime);
  expect(noopMs).toBeLessThan(rawMs * 5);
});
