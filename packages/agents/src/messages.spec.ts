import { describe, expect, it } from 'vitest';
import { createAgentMessageBus } from './messages.js';
import type { AgentMessage } from './messages.js';

describe('createAgentMessageBus', () => {
  it('delivers a published message only to subscribers of its toAgentId', () => {
    const bus = createAgentMessageBus();
    const receivedByApplications: AgentMessage[] = [];
    const receivedByPayments: AgentMessage[] = [];
    bus.subscribe('applications', (message) => receivedByApplications.push(message));
    bus.subscribe('payments', (message) => receivedByPayments.push(message));

    const message: AgentMessage = {
      id: 'm1',
      fromAgentId: 'orchestrator',
      toAgentId: 'applications',
      type: 'notify',
      payload: { applicationId: 'APP-1024' },
      correlationId: 'run-1',
    };
    bus.publish(message);

    expect(receivedByApplications).toEqual([message]);
    expect(receivedByPayments).toEqual([]);
  });

  it('delivers to every subscriber of the same agent id', () => {
    const bus = createAgentMessageBus();
    const first: AgentMessage[] = [];
    const second: AgentMessage[] = [];
    bus.subscribe('applications', (message) => first.push(message));
    bus.subscribe('applications', (message) => second.push(message));

    bus.publish({
      id: 'm1',
      fromAgentId: 'orchestrator',
      toAgentId: 'applications',
      type: 'notify',
      payload: {},
      correlationId: 'run-1',
    });

    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);
  });

  it('a message to an agent with no subscribers is silently dropped, not an error', () => {
    const bus = createAgentMessageBus();
    expect(() =>
      bus.publish({
        id: 'm1',
        fromAgentId: 'orchestrator',
        toAgentId: 'nobody-home',
        type: 'notify',
        payload: {},
        correlationId: 'run-1',
      }),
    ).not.toThrow();
  });

  it('unsubscribe stops further delivery to that listener only', () => {
    const bus = createAgentMessageBus();
    const received: AgentMessage[] = [];
    const unsubscribe = bus.subscribe('applications', (message) => received.push(message));

    bus.publish({
      id: 'm1',
      fromAgentId: 'orchestrator',
      toAgentId: 'applications',
      type: 'notify',
      payload: {},
      correlationId: 'run-1',
    });
    unsubscribe();
    bus.publish({
      id: 'm2',
      fromAgentId: 'orchestrator',
      toAgentId: 'applications',
      type: 'notify',
      payload: {},
      correlationId: 'run-1',
    });

    expect(received).toHaveLength(1);
    expect(received[0]?.id).toBe('m1');
  });
});
