import { InjectionToken } from '@angular/core';
import type { ClientModelReference, CopilotClient } from '@gixcopilot/client';
import type { CopilotContextOptions } from '@gixcopilot/headless';

/**
 * Configuration for one copilot instance. Exactly one of `endpoint` (the server's base URL,
 * e.g. `/api/copilot`) or an already-constructed `client` is required. Never put provider API
 * keys here: the browser talks only to your server, which owns the model provider.
 */
export type CopilotConfig = {
  readonly model?: ClientModelReference;
  readonly threadId?: string;
  readonly context?: CopilotContextOptions;
  /** Extra headers for every request (e.g. `Authorization`), read on each request. */
  readonly getHeaders?: () => Record<string, string> | Promise<Record<string, string>>;
  /** Offline UI tools only; never grants authority over server resources. Default false. */
  readonly localToolExecution?: boolean;
} & (
  | { readonly endpoint: string; readonly client?: never }
  | { readonly client: CopilotClient; readonly endpoint?: never }
);

export const COPILOT_CONFIG = new InjectionToken<CopilotConfig>('gixcopilot.config');
