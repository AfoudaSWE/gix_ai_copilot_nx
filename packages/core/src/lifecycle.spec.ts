import { describe, expect, it } from 'vitest';
import { RunLifecycle } from './lifecycle.js';

describe('RunLifecycle', () => {
  it('starts in the created state', () => {
    const lifecycle = new RunLifecycle();
    expect(lifecycle.status).toBe('created');
    expect(lifecycle.isTerminal).toBe(false);
  });

  it('allows created -> running -> completed', () => {
    const lifecycle = new RunLifecycle();
    lifecycle.transitionTo('running');
    expect(lifecycle.status).toBe('running');
    lifecycle.transitionTo('completed');
    expect(lifecycle.status).toBe('completed');
    expect(lifecycle.isTerminal).toBe(true);
  });

  it('allows running -> cancelled', () => {
    const lifecycle = new RunLifecycle();
    lifecycle.transitionTo('running');
    expect(lifecycle.canTransitionTo('cancelled')).toBe(true);
    lifecycle.transitionTo('cancelled');
    expect(lifecycle.status).toBe('cancelled');
  });

  it('allows created -> cancelled (cancelled before it ever started running)', () => {
    const lifecycle = new RunLifecycle();
    lifecycle.transitionTo('cancelled');
    expect(lifecycle.status).toBe('cancelled');
  });

  it('rejects completed -> running', () => {
    const lifecycle = new RunLifecycle();
    lifecycle.transitionTo('running');
    lifecycle.transitionTo('completed');
    expect(lifecycle.canTransitionTo('running')).toBe(false);
    expect(() => lifecycle.transitionTo('running')).toThrow(/Invalid run lifecycle transition/);
  });

  it('rejects failed -> completed', () => {
    const lifecycle = new RunLifecycle();
    lifecycle.transitionTo('running');
    lifecycle.transitionTo('failed');
    expect(() => lifecycle.transitionTo('completed')).toThrow(/Invalid run lifecycle transition/);
  });

  it('rejects any transition out of a terminal state, including a repeat of the same state', () => {
    const lifecycle = new RunLifecycle();
    lifecycle.transitionTo('running');
    lifecycle.transitionTo('cancelled');
    expect(() => lifecycle.transitionTo('cancelled')).toThrow(/Invalid run lifecycle transition/);
  });
});
