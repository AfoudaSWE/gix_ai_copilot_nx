import { createCopilot } from '@gixcopilot/node';
import { createOpenAIProvider } from '@gixcopilot/provider-openai';

const copilot = createCopilot({
  model: { provider: 'openai', model: process.env['OPENAI_MODEL'] ?? 'gpt-4o-mini' },
  providers: [createOpenAIProvider({ apiKey: process.env['OPENAI_API_KEY'] })],
});

await copilot.listen({ port: 4000 });
