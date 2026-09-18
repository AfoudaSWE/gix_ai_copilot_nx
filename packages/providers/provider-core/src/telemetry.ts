import type { CopilotErrorCode, FinishReason, Usage } from '@gixcopilot/protocol';
import type { ModelLatency } from './latency.js';

/**
 * Lightweight, injectable observability (Section 41) - a callback, not a platform. Never
 * carries API keys, auth headers, or raw provider request/response bodies (Section 32).
 * Phase 11 owns the full DevTools/observability platform this feeds into eventually.
 */
export type ModelRuntimeTelemetryEvent =
  | {
      readonly type: 'attempt_started';
      readonly provider: string;
      readonly model: string;
      readonly attempt: number;
      readonly maxAttempts: number;
    }
  | {
      readonly type: 'attempt_succeeded';
      readonly provider: string;
      readonly model: string;
      readonly attempt: number;
    }
  | {
      readonly type: 'attempt_failed';
      readonly provider: string;
      readonly model: string;
      readonly attempt: number;
      readonly maxAttempts: number;
      readonly code: CopilotErrorCode;
      readonly retryable: boolean;
      readonly willRetry: boolean;
    }
  | {
      readonly type: 'completed';
      readonly provider: string;
      readonly model: string;
      readonly attempts: number;
      readonly latency: ModelLatency;
      readonly finishReason: FinishReason;
      readonly usage?: Usage;
    }
  | {
      readonly type: 'failed';
      readonly provider: string;
      readonly model: string;
      readonly attempts: number;
      readonly code: CopilotErrorCode;
    };

export type ModelRuntimeTelemetryListener = (event: ModelRuntimeTelemetryEvent) => void;
