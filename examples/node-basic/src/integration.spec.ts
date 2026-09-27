import { afterEach, describe, expect, it } from 'vitest';
import { createNodeCopilot } from './main.js';

const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
});

describe('node-basic: createCopilot in a plain Node program', () => {
  it('answers through a firewall-checked backend tool (mock provider, no key)', async () => {
    const { copilot, audit } = createNodeCopilot({});
    closers.push(() => copilot.close());
    const result = await copilot.run({
      messages: [{ role: 'user', content: [{ type: 'text', text: 'Status of APP-1?' }] }],
      headers: { authorization: 'Bearer local-dev-token' },
    });
    expect(result.status).toBe('completed');
    expect(result.text).toContain('under review');
    expect(result.events.some((event) => event.type === 'tool.completed')).toBe(true);
    expect(audit.list().map((record) => record.decision)).toContain('execution.completed');
  });

  it('refuses the tool for an unauthenticated caller', async () => {
    const { copilot, audit } = createNodeCopilot({});
    closers.push(() => copilot.close());
    const result = await copilot.run('Status of APP-1?');
    expect(result.events.some((event) => event.type === 'tool.completed')).toBe(false);
    expect(audit.list().map((record) => record.decision)).not.toContain('execution.completed');
  });
});
