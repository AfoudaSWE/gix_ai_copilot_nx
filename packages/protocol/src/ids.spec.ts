import { describe, expect, it } from 'vitest';
import { createEventId, createMessageId, createRunId, createThreadId } from './ids.js';

describe('id factories', () => {
  it('generate non-empty, unique string ids', () => {
    const a = createRunId();
    const b = createRunId();
    expect(typeof a).toBe('string');
    expect(a.length).toBeGreaterThan(0);
    expect(a).not.toBe(b);
  });

  it('generate distinct ids across all id kinds', () => {
    const ids = [createRunId(), createThreadId(), createMessageId(), createEventId()];
    expect(new Set(ids).size).toBe(ids.length);
  });
});
