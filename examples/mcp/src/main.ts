import { createInterface } from 'node:readline/promises';
import { createCopilotClient } from '@gixcopilot/client';
import type { CopilotEvent } from '@gixcopilot/protocol';
import { createOpenAiDemoBackend, resolveOpenAiConfig } from './backend.js';

function printEvent(event: CopilotEvent): void {
  if (event.type === 'tool.requested') console.log(`  tool.requested ${event.name}`);
  else if (event.type === 'tool.completed') console.log(`  tool.completed ${event.name}`);
  else if (event.type === 'tool.failed') console.log(`  tool.failed ${event.name}: ${event.error.code}`);
  else if (event.type === 'message.delta') process.stdout.write(String(event.delta));
  else if (event.type === 'run.completed') console.log('\n  run.completed');
  else if (event.type === 'run.failed') console.log(`\n  run.failed: ${event.error.code} - ${event.error.message}`);
}

async function main(): Promise<void> {
  const question = process.argv[2] ?? 'What is widget WID-1?';

  const backend = await createOpenAiDemoBackend(resolveOpenAiConfig());
  console.log('AI Copilot SDK - Phase 8 MCP demo\n');
  console.log(`MCP generation report for server "${backend.integration.serverId}":`);
  console.log(JSON.stringify(backend.integration.report, null, 2));
  console.log(`\nGenerated tools: ${backend.integration.toolNames.join(', ')}\n`);

  await backend.copilotServer.listen({ port: 0, host: '127.0.0.1' });
  const address = backend.copilotServer.server.address();
  if (address === null || typeof address === 'string') throw new Error('Expected the server to bind to a TCP address.');
  const baseUrl = `http://127.0.0.1:${address.port}`;

  console.log(`Asking: ${JSON.stringify(question)}\n`);
  const client = createCopilotClient({ baseUrl, getHeaders: () => ({ authorization: 'Bearer demo' }) });
  const run = client.run({
    model: { provider: 'openai', model: process.env['OPENAI_MODEL'] || 'gpt-4o-mini' },
    messages: [{ role: 'user', content: [{ type: 'text', text: question }] }],
  });

  try {
    for await (const event of run.events) {
      printEvent(event);
      if (event.type === 'approval.requested') {
        const terminal = createInterface({ input: process.stdin, output: process.stdout });
        try {
          const answer = await terminal.question(`Approve external action (${event.approvalLevel})? [y/N] `);
          await client.decideApproval(event.approvalId, answer.trim().toLowerCase() === 'y' ? 'approve' : 'reject');
        } finally { terminal.close(); }
      }
    }
  } finally {
    await backend.close();
  }
}

main().catch((error: unknown) => {
  console.error('Fatal error running the MCP demo:', error);
  process.exitCode = 1;
});
