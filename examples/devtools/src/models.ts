import type { ModelProvider } from '@gixcopilot/provider';
import { createTestModel } from '@gixcopilot/testing';
import type { TestModelTurn } from '@gixcopilot/testing';

/** Tool results already in the conversation, as data. */
function results(turn: TestModelTurn): unknown[] {
  return turn.request.messages.flatMap((message) => message.content.flatMap((part) => (part.type === 'tool_result' && part.result.status === 'success' ? [part.result.data] : [])));
}

const done = (turn: TestModelTurn): boolean => turn.toolResults.length > 0;

/**
 * Deterministic scripted models (no credentials needed) so the DevTools demo produces the same
 * realistic session every time. `MODEL_PROVIDER=openai` replaces them with the real provider.
 */
export function createDemoModels(): ModelProvider[] {
  const chat = createTestModel(
    [
      { when: (turn) => /delete app-1024/i.test(turn.lastUserText) && !done(turn), respond: { toolCalls: [{ name: 'applications.delete', arguments: { id: 'APP-1024' } }] } },
      { when: (turn) => /delete/i.test(turn.lastUserText), respond: { text: 'I am not allowed to delete applications.' } },
      { when: (turn) => turn.toolResults.includes('applications.reassign'), respond: { text: 'APP-1024 is under review and is now assigned to Officer B.' } },
      { when: (turn) => turn.toolResults.includes('applications.get'), respond: { toolCalls: [{ name: 'applications.reassign', arguments: { id: 'APP-1024', assignee: 'Officer B' } }] } },
      {
        when: (turn) => /app-1024/i.test(turn.lastUserText),
        respond: { toolCalls: [{ name: 'applications.get', arguments: { id: 'APP-1024' } }, { name: 'ui.render.applicationCard', arguments: { id: 'APP-1024', status: 'under_review' } }] },
      },
    ],
    { id: 'chat-model', fallback: { text: 'How can I help with your application?' } },
  );
  const orchestrator = createTestModel(
    [
      { when: (turn) => turn.toolResults.length >= 3, respond: { text: 'APP-1024 is under review, your card payment is verified, and applications are approved once identity and payment are confirmed [S1].' } },
      {
        respond: {
          toolCalls: [
            { name: 'agent.delegate.application', arguments: { task: 'What is the status of APP-1024?' } },
            { name: 'agent.delegate.payment', arguments: { task: 'Is my payment verified?' } },
            { name: 'agent.delegate.knowledge', arguments: { task: 'When is an application approved?' } },
          ],
        },
      },
    ],
    { id: 'orchestrator-model' },
  );
  const specialist = (id: string, call: { name: string; arguments?: Record<string, unknown> }[], answer: (turn: TestModelTurn) => string) =>
    createTestModel([{ when: done, respond: (turn) => ({ text: answer(turn) }) }, { respond: { toolCalls: call } }], { id });
  return [
    chat,
    orchestrator,
    specialist('application-model', [{ name: 'applications.get', arguments: { id: 'APP-1024' } }], (turn) => `Application: ${JSON.stringify(results(turn)[0] ?? {})}`),
    specialist('payment-model', [{ name: 'payments.get' }], (turn) => `Payment: ${JSON.stringify(results(turn)[0] ?? {})}`),
    specialist('knowledge-model', [{ name: 'knowledge.search', arguments: { query: 'when is an application approved' } }, { name: 'memory.recall' }], () => 'Applications are approved once identity documents and payment are verified [S1].'),
  ];
}
