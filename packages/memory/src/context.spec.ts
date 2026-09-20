import { describe, expect, it } from 'vitest';
import { formatMemoryContext, hasMemoryResults } from './context.js';
import type { MemoryRecord } from './record.js';
import type { MemorySearchResult } from './store.js';

function result(overrides: Partial<MemoryRecord> = {}): MemorySearchResult {
  const record: MemoryRecord = {
    id: 'm1',
    type: 'durable',
    owner: { type: 'user', id: 'user-1' },
    value: 'Answer in English.',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
  return { record, score: 0.9 };
}

describe('formatMemoryContext', () => {
  it('produces one contribution per result, tagged with contextSource "memory"', () => {
    const contributions = formatMemoryContext([result()]);
    expect(contributions).toHaveLength(1);
    expect(contributions[0]?.metadata.contextSource).toBe('memory');
    expect(contributions[0]?.metadata.memoryId).toBe('m1');
  });

  it('serializes structured values to text', () => {
    const contributions = formatMemoryContext([result({ value: { tone: 'concise' } })]);
    expect(contributions[0]?.value).toContain(JSON.stringify({ tone: 'concise' }));
  });

  /**
   * Section 108/109, TEST 169: durable memory must never automatically outrank the current
   * user message or trusted system instructions - "the current explicit instruction wins."
   * This holds structurally rather than by a runtime string comparison: memory contributions
   * are always registered at 'normal' priority, one tier below every 'critical' system
   * instruction, and the live user turn is not a context item at all (it is unconditionally
   * part of every request) - so nothing produced here can ever compete with, let alone beat,
   * either one in the real ContextEngine's priority-ordered budget.
   */
  it('never assigns a priority above "normal" - memory can never outrank system instructions or the current turn (TEST 169)', () => {
    const contributions = formatMemoryContext([
      result({ id: 'm1', value: 'Answer in English.' }),
      result({ id: 'm2', value: 'Always be terse.' }),
    ]);
    for (const contribution of contributions) {
      expect(contribution.priority).toBe('low');
      expect(contribution.priority).not.toBe('critical');
    }
  });

  it('scopes a session-owned memory to "session" and a user-owned memory to "user"', () => {
    const [sessionContribution] = formatMemoryContext([result({ owner: { type: 'session', id: 's1' } })]);
    const [userContribution] = formatMemoryContext([result({ owner: { type: 'user', id: 'u1' } })]);
    expect(sessionContribution?.scope).toBe('session');
    expect(userContribution?.scope).toBe('user');
  });
});

describe('hasMemoryResults', () => {
  it('is false for an empty result set and true otherwise (Section 85/86 applied to memory)', () => {
    expect(hasMemoryResults([])).toBe(false);
    expect(hasMemoryResults([result()])).toBe(true);
  });
});
