import { describe, expect, it, vi } from 'vitest';
import { createRunId, createThreadId } from '@aicopilot/protocol';
import type { RuntimeRun } from '@aicopilot/core';
import { createRunRegistry } from './run-registry.js';

function fakeRun(): { run: RuntimeRun; cancel: ReturnType<typeof vi.fn> } {
  const cancel = vi.fn();
  const run: RuntimeRun = {
    runId: createRunId(),
    threadId: createThreadId(),
    events: (async function* () {})(),
    cancel,
  };
  return { run, cancel };
}

describe('createRunRegistry', () => {
  it('registers and retrieves a run by id', () => {
    const registry = createRunRegistry();
    const { run } = fakeRun();
    registry.register(run);
    expect(registry.get(run.runId)).toBe(run);
  });

  it('returns undefined for an unknown id', () => {
    const registry = createRunRegistry();
    expect(registry.get(createRunId())).toBeUndefined();
  });

  it('forgets a run once unregistered', () => {
    const registry = createRunRegistry();
    const { run } = fakeRun();
    registry.register(run);
    registry.unregister(run.runId);
    expect(registry.get(run.runId)).toBeUndefined();
  });

  it('cancelAll cancels every currently registered run', () => {
    const registry = createRunRegistry();
    const a = fakeRun();
    const b = fakeRun();
    registry.register(a.run);
    registry.register(b.run);
    registry.cancelAll();
    expect(a.cancel).toHaveBeenCalledTimes(1);
    expect(b.cancel).toHaveBeenCalledTimes(1);
  });
});
