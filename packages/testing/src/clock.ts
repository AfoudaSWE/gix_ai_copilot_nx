/** Injected time for time-sensitive tests (Phase 11 Section 86) - no real waiting. */
export interface FakeClock {
  now(): Date;
  nowMs(): number;
  advance(ms: number): Date;
  set(at: Date | number): Date;
}

export function createFakeClock(start: Date | number = Date.UTC(2026, 0, 1)): FakeClock {
  let current = typeof start === 'number' ? start : start.getTime();
  return {
    now: () => new Date(current),
    nowMs: () => current,
    advance(ms) {
      if (ms < 0) throw new RangeError('A fake clock only moves forward.');
      current += ms;
      return new Date(current);
    },
    set(at) {
      current = typeof at === 'number' ? at : at.getTime();
      return new Date(current);
    },
  };
}

/** Deterministic ids (Section 87): `prefix-1`, `prefix-2`, ... - never random UUIDs. */
export function createSequentialIds(prefix = 'id'): () => string {
  let next = 0;
  return () => {
    next += 1;
    return `${prefix}-${next}`;
  };
}
