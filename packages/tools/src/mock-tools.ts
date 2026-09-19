import { z } from 'zod';
import { defineTool } from './define-tool.js';
import type { ToolDefinition } from './tool-definition.js';

/**
 * Deterministic test/example tools (Section 71-72). Never used by the runtime by default -
 * a consumer (test, example app, or `examples/react-tools`) registers these explicitly.
 */
export const mathAddTool: ToolDefinition<{ a: number; b: number }, { result: number }> =
  defineTool({
    name: 'math.add',
    description: 'Add two numbers together.',
    input: z.object({ a: z.number(), b: z.number() }),
    output: z.object({ result: z.number() }),
    metadata: { category: 'math', readOnly: true, idempotent: true, source: 'native' },
    execute({ a, b }) {
      return Promise.resolve({ result: a + b });
    },
  });

const APPLICATION_STATUSES: Readonly<Record<string, string>> = {
  'APP-1024': 'PENDING',
  'APP-2048': 'APPROVED',
};

export const applicationsGetStatusTool: ToolDefinition<
  { applicationId: string },
  { applicationId: string; status: string }
> = defineTool({
  name: 'applications.getStatus',
  description: 'Get the current status of an application by its id.',
  input: z.object({ applicationId: z.string().min(1) }),
  output: z.object({ applicationId: z.string(), status: z.string() }),
  metadata: { category: 'applications', readOnly: true, source: 'native' },
  execute({ applicationId }) {
    return Promise.resolve({
      applicationId,
      status: APPLICATION_STATUSES[applicationId] ?? 'UNKNOWN',
    });
  },
});
