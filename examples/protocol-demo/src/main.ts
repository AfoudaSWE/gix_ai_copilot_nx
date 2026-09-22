import { createServer } from '@gixcopilot/server';
import { createEchoExecutor, createRuntime } from '@gixcopilot/core';
import { createCopilotClient } from '@gixcopilot/client';
import type { CopilotEvent } from '@gixcopilot/protocol';

function printEvent(event: CopilotEvent): void {
  switch (event.type) {
    case 'run.started':
      console.log(`[${event.sequence}] run.started`);
      break;
    case 'message.started':
      console.log(`[${event.sequence}] message.started (${event.role})`);
      break;
    case 'message.delta':
      console.log(`[${event.sequence}] message.delta ${JSON.stringify(event.delta)}`);
      break;
    case 'message.end': {
      const text = event.content.map((part) => (part.type === 'text' ? part.text : '')).join('');
      console.log(`[${event.sequence}] message.end -> "${text}"`);
      break;
    }
    case 'run.completed':
      console.log(`[${event.sequence}] run.completed (usage: ${JSON.stringify(event.usage)})`);
      break;
    case 'run.failed':
      console.log(`[${event.sequence}] run.failed: ${event.error.code} - ${event.error.message}`);
      break;
    case 'run.cancelled':
      console.log(`[${event.sequence}] run.cancelled`);
      break;
    case 'error':
      console.log(`[${event.sequence}] error: ${event.error.code} - ${event.error.message}`);
      break;
    case 'tool.requested':
      console.log(`[${event.sequence}] tool.requested ${event.name} (${event.source})`);
      break;
    case 'tool.started':
      console.log(`[${event.sequence}] tool.started ${event.name}`);
      break;
    case 'tool.completed':
      console.log(`[${event.sequence}] tool.completed ${event.name}`);
      break;
    case 'tool.failed':
      console.log(`[${event.sequence}] tool.failed ${event.name}: ${event.error.code}`);
      break;
    case 'approval.requested':
    case 'approval.approved':
    case 'approval.rejected':
    case 'approval.expired':
    case 'agent.run.started':
    case 'agent.run.completed':
    case 'agent.run.failed':
    case 'agent.run.cancelled':
    case 'agent.delegation.started':
    case 'agent.delegation.completed':
    case 'agent.handoff':
    case 'agent.routing.decided':
    case 'workflow.run.started':
    case 'workflow.run.paused':
    case 'workflow.run.resumed':
    case 'workflow.run.completed':
    case 'workflow.run.failed':
    case 'workflow.run.cancelled':
    case 'workflow.step.started':
    case 'workflow.step.completed':
    case 'workflow.step.failed':
    case 'workflow.checkpoint.saved':
      break;
    default: {
      const exhaustive: never = event;
      throw new Error(`Unhandled event type: ${JSON.stringify(exhaustive)}`);
    }
  }
}

async function main(): Promise<void> {
  const inputText = process.argv[2] ?? 'Hello protocol';

  // The only executor in this demo is the deterministic reference one from @gixcopilot/core -
  // no LLM, no provider, no network call to any AI service. See docs/architecture/overview.md.
  const runtime = createRuntime({ executor: createEchoExecutor({ delayMsPerChunk: 60 }) });
  const app = createServer({ runtime });
  await app.listen({ port: 0, host: '127.0.0.1' });

  const address = app.server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('Expected the server to bind to a TCP address.');
  }
  const baseUrl = `http://127.0.0.1:${address.port}`;

  console.log('AI Copilot SDK - Phase 1 protocol demo');
  console.log(`Server listening at ${baseUrl}`);
  console.log(`Sending: ${JSON.stringify(inputText)}\n`);

  const client = createCopilotClient({ baseUrl });
  const run = client.run({
    messages: [{ role: 'user', content: [{ type: 'text', text: inputText }] }],
  });

  const onSigint = (): void => {
    console.log('\nReceived SIGINT - cancelling run...');
    run.cancel();
  };
  process.once('SIGINT', onSigint);

  try {
    for await (const event of run.events) {
      printEvent(event);
    }
  } finally {
    process.off('SIGINT', onSigint);
    await app.close();
  }
}

main().catch((error: unknown) => {
  console.error('Fatal error running the protocol demo:', error);
  process.exitCode = 1;
});
