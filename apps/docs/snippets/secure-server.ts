import { createCopilot } from '@gixcopilot/node';
import { createOpenAIProvider } from '@gixcopilot/provider-openai';
import { createActionFirewall, createInMemoryAuditSink } from '@gixcopilot/security';
import type { AuthenticationAdapter } from '@gixcopilot/security';
import { applicationsGet } from './tool.js';

declare const authentication: AuthenticationAdapter; // your identity provider's verifier

const copilot = createCopilot({
  model: { provider: 'openai', model: 'gpt-4o-mini' },
  providers: [createOpenAIProvider({ apiKey: process.env['OPENAI_API_KEY'] })],
  tools: [applicationsGet],
  security: { authentication, firewall: createActionFirewall({ audit: createInMemoryAuditSink() }) },
  server: { requireAuthentication: true },
});
await copilot.listen({ port: 4000 });
