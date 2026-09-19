import { z } from 'zod';

const messageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant', 'tool']),
  content: z
    .array(
      z.object({
        type: z.literal('text'),
        text: z.string(),
      }),
    )
    .min(1),
});

/** Optional - a request without `model` runs against the server's default injected Runtime (Phase 1 behavior, e.g. the echo executor). */
const modelReferenceSchema = z.object({
  provider: z.string().min(1),
  model: z.string().min(1),
});

/**
 * A client-declared frontend tool (Section 45-46, added in Phase 5). The client sends this
 * wire-safe manifest - a JSON Schema `parameters` object, never a Zod schema instance - so
 * the server can offer it to the model even though only the browser can execute it.
 */
const toolManifestEntrySchema = z.object({
  name: z.string().min(1),
  description: z.string(),
  parameters: z.record(z.string(), z.unknown()),
  executionLocation: z.enum(['server', 'client']),
});

export const createRunRequestSchema = z.object({
  threadId: z.string().min(1).optional(),
  model: modelReferenceSchema.optional(),
  /**
   * The full conversation, oldest first. Renamed/pluralized in Phase 2 (was a single
   * `message`) so multi-turn history can reach a model - see
   * docs/adr/0006-model-provider-abstraction.md.
   */
  messages: z.array(messageSchema).min(1),
  /** Added in Phase 5 - frontend tools registered in the browser for this run only. */
  tools: z.array(toolManifestEntrySchema).optional(),
});

export type CreateRunRequestBody = z.infer<typeof createRunRequestSchema>;

export const cancelRunParamsSchema = z.object({
  runId: z.string().min(1),
});

const publicCopilotErrorBodySchema = z.object({
  code: z.string().min(1),
  message: z.string(),
  retryable: z.boolean(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

/** The body of `POST /runs/:runId/tool-results` (Section 50, added in Phase 5) - a frontend
 * tool's outcome, reported back so the paused Model -> Tool -> Model loop can resume. */
export const submitToolResultRequestSchema = z.object({
  toolCallId: z.string().min(1),
  result: z.discriminatedUnion('status', [
    z.object({ status: z.literal('success'), toolCallId: z.string().min(1), data: z.unknown() }),
    z.object({
      status: z.literal('error'),
      toolCallId: z.string().min(1),
      error: publicCopilotErrorBodySchema,
    }),
  ]),
});

export type SubmitToolResultRequestBody = z.infer<typeof submitToolResultRequestSchema>;

export const submitToolResultParamsSchema = z.object({
  runId: z.string().min(1),
});
