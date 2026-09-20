import { CopilotError } from '@gixcopilot/protocol';
import type { MemoryType } from './record.js';

const TTL: Readonly<Record<MemoryType, number>> = {
  working: 60 * 60 * 1000,
  session: 24 * 60 * 60 * 1000,
  durable: 90 * 24 * 60 * 60 * 1000,
  semantic: 90 * 24 * 60 * 60 * 1000,
};

/** Explicit expiry overrides the bounded per-kind retention defaults. */
export function memoryExpiry(type: MemoryType, expiresAt: string | undefined, now: Date): string {
  const expiry = expiresAt === undefined ? now.getTime() + TTL[type] : Date.parse(expiresAt);
  if (!Number.isFinite(expiry)) throw CopilotError.validation('Memory expiry must be a valid date.');
  return new Date(expiry).toISOString();
}
