import { describe, expect, it } from 'vitest';
import { EventSequencer } from './sequencer.js';

describe('EventSequencer', () => {
  it('starts at 1 and increases strictly by 1 each call', () => {
    const sequencer = new EventSequencer();
    expect(sequencer.next()).toBe(1);
    expect(sequencer.next()).toBe(2);
    expect(sequencer.next()).toBe(3);
  });

  it('gives each run its own independent sequence when a new instance is created', () => {
    const a = new EventSequencer();
    const b = new EventSequencer();
    a.next();
    a.next();
    expect(b.next()).toBe(1);
  });
});
