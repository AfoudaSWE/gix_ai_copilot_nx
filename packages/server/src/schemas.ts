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

export const createRunRequestSchema = z.object({
  threadId: z.string().min(1).optional(),
  model: modelReferenceSchema.optional(),
  /**
   * The full conversation, oldest first. Renamed/pluralized in Phase 2 (was a single
   * `message`) so multi-turn history can reach a model - see
   * docs/adr/0006-model-provider-abstraction.md.
   */
  messages: z.array(messageSchema).min(1),
});

export type CreateRunRequestBody = z.infer<typeof createRunRequestSchema>;

export const cancelRunParamsSchema = z.object({
  runId: z.string().min(1),
});
