import { z } from 'zod';

export const ENVIRONMENTS = ['development', 'test', 'staging', 'production'] as const;
export type DeploymentEnvironment = (typeof ENVIRONMENTS)[number];

/**
 * A reference to a secret, never the secret itself: `{ "secret": "OPENAI_API_KEY" }` in a
 * config file is resolved through the configured `SecretProvider` at startup.
 */
export const secretRefSchema = z.object({ secret: z.string().regex(/^[A-Za-z0-9._-]+$/) }).strict();
export type SecretRef = z.infer<typeof secretRefSchema>;

const modelReferenceSchema = z.object({ provider: z.string().min(1), model: z.string().min(1) }).strict();

const providerSchema = z
  .object({
    apiKey: secretRefSchema.optional(),
    baseUrl: z.url().optional(),
    enabled: z.boolean().default(true),
  })
  .strict();

/** The whole production configuration model. Every field has a documented source. */
export const copilotConfigSchema = z
  .object({
    environment: z.enum(ENVIRONMENTS).default('development'),
    service: z
      .object({
        name: z.string().min(1).default('aicopilot-api'),
        host: z.string().min(1).default('127.0.0.1'),
        port: z.coerce.number().int().min(0).max(65535).default(4000),
        logLevel: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
        /** Seconds allowed for in-flight work during graceful shutdown. */
        shutdownGraceSeconds: z.coerce.number().int().min(0).max(600).default(25),
      })
      .strict()
      .prefault({}),
    database: z.object({ url: secretRefSchema.optional(), poolMax: z.coerce.number().int().min(1).max(200).default(10) }).strict().prefault({}),
    redis: z.object({ url: secretRefSchema.optional() }).strict().prefault({}),
    models: z
      .object({
        default: modelReferenceSchema.optional(),
        providers: z.record(z.string().min(1), providerSchema).default({}),
      })
      .strict()
      .prefault({}),
    security: z
      .object({
        /** Reject unauthenticated runs. Forced on in staging and production. */
        requireAuthentication: z.boolean().default(false),
        /** Trusted identity header/token settings live in the application's AuthenticationAdapter. */
        corsOrigins: z.array(z.string().min(1)).default([]),
        /** HS256 JWT verification for the reference API server (use your own adapter/OIDC gateway otherwise). */
        jwt: z.object({ secret: secretRefSchema.optional(), issuer: z.string().min(1).optional(), audience: z.string().min(1).optional() }).strict().prefault({}),
      })
      .strict()
      .prefault({}),
    telemetry: z
      .object({
        mode: z.enum(['off', 'metadata-only', 'redacted', 'development-verbose']).default('redacted'),
        otlpEndpoint: z.url().optional(),
        traceSampleRatio: z.coerce.number().min(0).max(1).default(1),
        metricsEnabled: z.boolean().default(false),
        /** Bearer token required by /metrics. */
        metricsToken: secretRefSchema.optional(),
      })
      .strict()
      .prefault({}),
    devtools: z.object({ enabled: z.boolean().default(false), token: secretRefSchema.optional() }).strict().prefault({}),
    management: z
      .object({
        enabled: z.boolean().default(false),
        /** 32-byte base64 key that encrypts platform-stored secrets (AES-256-GCM). */
        secretKey: secretRefSchema.optional(),
      })
      .strict()
      .prefault({}),
    /**
     * Data lifecycle (Section 176-177): separate retention per data class, enforced by the
     * worker's maintenance job. Unset means "keep". Memory also expires by its own TTLs.
     */
    retention: z
      .object({
        conversationDays: z.coerce.number().int().positive().optional(),
        auditDays: z.coerce.number().int().positive().optional(),
        usageDays: z.coerce.number().int().positive().optional(),
      })
      .strict()
      .prefault({}),
    features: z.record(z.string().regex(/^[a-z0-9][a-z0-9.-]*$/), z.boolean()).default({}),
  })
  .strict();

/** Config as written (file, env, code): every field optional. */
export type CopilotConfigInput = z.input<typeof copilotConfigSchema>;
/** Config after defaults and validation, before secret resolution. */
export type CopilotConfigData = z.output<typeof copilotConfigSchema>;
