import type { z } from 'zod';
import { CopilotError } from '@gixcopilot/protocol';
import type { ModelReference } from './model-reference.js';
import type { ModelMessage } from './model-message.js';
import type { ModelRuntime } from './model-runtime.js';

/**
 * Provider-neutral structured output (Section 42-43) - distinct from tool output (Section
 * 42's explicit warning): a tool has a name and is invoked by the model's own choice mid-
 * conversation, while `generateObject` is the caller directly asking a model to produce one
 * JSON value matching `schema`, with no tool-calling round trip. Built on the same
 * `ModelRuntime.stream()` every other model call goes through - no parallel "structured mode"
 * request path.
 */
export interface GenerateObjectOptions<TSchema extends z.ZodType> {
  readonly runtime: ModelRuntime;
  readonly model?: ModelReference;
  readonly messages: readonly ModelMessage[];
  readonly schema: TSchema;
  readonly temperature?: number;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
}

export interface GenerateObjectResult<TSchema extends z.ZodType> {
  readonly object: z.infer<TSchema>;
}

/**
 * A system-message instruction appended so a model without native structured-output support
 * (including the deterministic mock provider) still has a chance to produce valid JSON. A
 * provider adapter with native structured-output support may ignore `messages` shape details
 * and use its own mechanism instead - this function only prescribes the *contract*
 * (validated JSON matching `schema`), not how a specific provider gets there.
 */
function withJsonInstruction(messages: readonly ModelMessage[]): readonly ModelMessage[] {
  return [
    {
      role: 'system',
      content: [
        {
          type: 'text',
          text: 'Respond with a single JSON object only - no prose, no code fences.',
        },
      ],
    },
    ...messages,
  ];
}

/**
 * Streams a model call and validates its aggregated text output against `schema`. Never
 * returns unchecked JSON (Section 43) - a response that is not valid JSON, or that fails
 * schema validation, is a `CopilotError.validation` rejection, not a best-effort partial
 * object.
 */
export async function generateObject<TSchema extends z.ZodType>(
  options: GenerateObjectOptions<TSchema>,
): Promise<GenerateObjectResult<TSchema>> {
  let aggregatedText = '';

  for await (const event of options.runtime.stream({
    model: options.model,
    messages: withJsonInstruction(options.messages),
    temperature: options.temperature,
    timeoutMs: options.timeoutMs,
    signal: options.signal,
  })) {
    switch (event.type) {
      case 'content.delta':
        aggregatedText += event.delta;
        break;
      case 'model.failed':
        throw new CopilotError(event.error.code, event.error.message, {
          retryable: event.error.retryable,
          metadata: event.error.metadata,
        });
      case 'model.started':
      case 'usage.updated':
      case 'tool_call.requested':
      case 'model.completed':
        break;
      default: {
        const exhaustive: never = event;
        throw new Error(`Unhandled model stream event: ${JSON.stringify(exhaustive)}`);
      }
    }
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(aggregatedText);
  } catch {
    throw CopilotError.validation('The model did not return valid JSON for generateObject().', {
      preview: aggregatedText.slice(0, 200),
    });
  }

  const result = options.schema.safeParse(parsed);
  if (!result.success) {
    throw CopilotError.validation(
      'The model returned JSON that does not match the requested schema.',
      { issueCount: result.error.issues.length },
    );
  }

  return { object: result.data };
}
