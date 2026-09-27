// app/api/copilot/[...path]/route.ts (Next.js App Router)
import { createCopilot } from '@gixcopilot/node';
import { createOpenAIProvider } from '@gixcopilot/provider-openai';
import { crm } from './connector.js';

const copilot = createCopilot({
  model: { provider: 'openai', model: 'gpt-4o-mini' },
  providers: [createOpenAIProvider({ apiKey: process.env['OPENAI_API_KEY'] })],
  tools: [...crm.tools],
});

const handler = copilot.fetchHandler({ basePath: '/api/copilot' });
export const GET = handler;
export const POST = handler;
export const runtime = 'nodejs'; // streaming SSE on the Node.js runtime
export const dynamic = 'force-dynamic';
