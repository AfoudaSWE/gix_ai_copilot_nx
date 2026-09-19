import { describe, expect, it } from 'vitest';
import { createEnterpriseServer } from './backend.js';

describe('enterprise example', () => {
  it('runs real application actions without substituting a fake model', async () => {
    const app = createEnterpriseServer();
    try {
      expect((await app.inject('/demo-config')).json()).toEqual({ model: null });
      const response = await app.inject({ method: 'POST', url: '/runs', headers: { authorization: 'Bearer viewer' },
        payload: { messages: [{ role: 'user', content: [{ type: 'text', text: 'Read' }] }], action: { name: 'applications.get', arguments: { applicationId: 'APP-1024' } } },
      });
      expect(response.body).toContain('tool.completed');
      expect(response.body).toContain('A******78');
      expect(response.body).not.toContain('A12345678');
      const denied = await app.inject({ method: 'POST', url: '/runs', headers: { authorization: 'Bearer viewer' },
        payload: { messages: [{ role: 'user', content: [{ type: 'text', text: 'Delete' }] }], action: { name: 'applications.delete', arguments: { applicationId: 'APP-1024' } } },
      });
      expect(denied.body).toContain('PERMISSION_DENIED');
    } finally { await app.close(); }
  });
});
