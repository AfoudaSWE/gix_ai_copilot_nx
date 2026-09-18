import { z } from 'zod';

export const createRunRequestSchema = z.object({
  threadId: z.string().min(1).optional(),
  message: z.object({
    role: z.enum(['system', 'user', 'assistant', 'tool']),
    content: z
      .array(
        z.object({
          type: z.literal('text'),
          text: z.string(),
        }),
      )
      .min(1),
  }),
});

export type CreateRunRequestBody = z.infer<typeof createRunRequestSchema>;

export const cancelRunParamsSchema = z.object({
  runId: z.string().min(1),
});
