import { createModelRuntime, DEFAULT_RETRY_POLICY } from '@gixcopilot/provider';
import type { ModelProvider, ModelRuntime } from '@gixcopilot/provider';
import type { PublicCopilotError } from '@gixcopilot/protocol';
import { z } from 'zod';
import { redactSecrets } from '../apply/secret-scan.js';

/** What a provider factory receives: the only place the key is ever handed over. */
export interface ProviderSettings {
  readonly apiKey?: string;
  readonly baseUrl?: string;
  readonly timeoutMs?: number;
}

/**
 * Builds an existing provider adapter (e.g. `createOpenAIProvider`) from Studio settings.
 * Supplied by the host so the Studio never imports a provider SDK (§8 provider-neutral).
 */
export type ProviderFactory = (settings: ProviderSettings) => ModelProvider;

export const modelSettingsSchema = z
  .object({
    provider: z.string().regex(/^[a-z][a-z0-9-]*$/),
    model: z.string().min(1).max(200),
    /** Write-only. Never returned by any Studio endpoint (§8). */
    apiKey: z.string().min(1).max(500).optional(),
    baseUrl: z.url().optional(),
    timeoutMs: z.number().int().min(1000).max(300_000).optional(),
    retries: z.number().int().min(0).max(10).optional(),
  })
  .strict();

export type ModelSettingsInput = z.infer<typeof modelSettingsSchema>;

/** The browser-safe view of model settings. There is deliberately no `apiKey` field (§8). */
export interface PublicModelSettings {
  readonly provider: string;
  readonly model: string;
  readonly configured: boolean;
  readonly keySource: 'studio-session' | 'environment' | 'none';
  readonly baseUrl?: string;
  readonly timeoutMs?: number;
  readonly retries?: number;
  readonly providers: readonly string[];
}

export interface ConnectionTestResult {
  readonly success: boolean;
  readonly provider: string;
  readonly model: string;
  readonly latencyMs: number;
  readonly error?: { readonly code: string; readonly message: string; readonly retryable: boolean };
}

export interface ModelSettingsStore {
  get(): PublicModelSettings;
  set(input: unknown): PublicModelSettings;
  test(signal?: AbortSignal): Promise<ConnectionTestResult>;
}

export interface ModelSettingsOptions {
  readonly initial?: { readonly provider: string; readonly model: string };
  readonly providers?: Readonly<Record<string, ProviderFactory>>;
  /** The host's already-configured runtime; used when the Studio holds no key of its own. */
  readonly runtime?: ModelRuntime;
  /** Environment variable per provider that already holds a key, e.g. `{ openai: 'OPENAI_API_KEY' }`. */
  readonly keyEnvironment?: Readonly<Record<string, string>>;
  readonly env?: Readonly<Record<string, string | undefined>>;
}

function normalizeError(error: unknown): NonNullable<ConnectionTestResult['error']> {
  if (typeof error === 'object' && error !== null && 'code' in error && 'message' in error) {
    const value = error as PublicCopilotError;
    return { code: String(value.code), message: redactSecrets(value.message), retryable: value.retryable };
  }
  return { code: 'UNKNOWN', message: redactSecrets(error instanceof Error ? error.message : 'The provider call failed.'), retryable: false };
}

/**
 * Model settings for the development session. The API key lives only in this process's
 * memory: it is passed to the host's provider factory for Test Connection and is never
 * written to disk, returned to the browser, logged, or put in generated code (§8-9, §55).
 */
export function createModelSettingsStore(options: ModelSettingsOptions = {}): ModelSettingsStore {
  const env = options.env ?? process.env;
  let settings: Omit<ModelSettingsInput, 'apiKey'> = { provider: options.initial?.provider ?? 'openai', model: options.initial?.model ?? 'gpt-4o-mini' };
  let sessionKey: string | undefined;

  const view = (): PublicModelSettings => {
    const variable = options.keyEnvironment?.[settings.provider];
    const keySource = sessionKey ? 'studio-session' : variable && env[variable] ? 'environment' : 'none';
    return {
      provider: settings.provider,
      model: settings.model,
      // Without a factory for this provider, Test Connection uses the host's own runtime,
      // which the host configured with its key.
      configured: keySource !== 'none' || (options.providers?.[settings.provider] === undefined && options.runtime !== undefined),
      keySource,
      ...(settings.baseUrl ? { baseUrl: settings.baseUrl } : {}),
      ...(settings.timeoutMs ? { timeoutMs: settings.timeoutMs } : {}),
      ...(settings.retries !== undefined ? { retries: settings.retries } : {}),
      providers: Object.keys(options.providers ?? {}),
    };
  };

  const runtimeFor = (): ModelRuntime | undefined => {
    const factory = options.providers?.[settings.provider];
    if (factory) {
      const variable = options.keyEnvironment?.[settings.provider];
      const apiKey = sessionKey ?? (variable ? env[variable] : undefined);
      return createModelRuntime({ providers: [factory({ ...(apiKey ? { apiKey } : {}), ...(settings.baseUrl ? { baseUrl: settings.baseUrl } : {}), ...(settings.timeoutMs ? { timeoutMs: settings.timeoutMs } : {}) })], defaults: { ...(settings.timeoutMs ? { timeoutMs: settings.timeoutMs } : {}), retry: { ...DEFAULT_RETRY_POLICY, maxAttempts: (settings.retries ?? 0) + 1 } } });
    }
    return options.runtime;
  };

  return {
    get: view,
    set(input) {
      const parsed = modelSettingsSchema.parse(input);
      const { apiKey, ...rest } = parsed;
      settings = rest;
      if (apiKey !== undefined) sessionKey = apiKey;
      return view();
    },
    async test(signal) {
      const started = performance.now();
      const base = { provider: settings.provider, model: settings.model };
      const runtime = runtimeFor();
      if (!runtime) return { ...base, success: false, latencyMs: 0, error: { code: 'PROVIDER_NOT_CONFIGURED', message: `No provider adapter is available for "${settings.provider}".`, retryable: false } };
      try {
        for await (const event of runtime.stream({ model: base, messages: [{ role: 'user', content: [{ type: 'text', text: 'Reply with OK.' }] }], maxOutputTokens: 5, ...(signal ? { signal } : {}) })) {
          if (event.type === 'model.failed') return { ...base, success: false, latencyMs: Math.round(performance.now() - started), error: normalizeError(event.error) };
          if (event.type === 'model.completed') break;
        }
        return { ...base, success: true, latencyMs: Math.round(performance.now() - started) };
      } catch (error) {
        return { ...base, success: false, latencyMs: Math.round(performance.now() - started), error: normalizeError(error) };
      }
    },
  };
}
