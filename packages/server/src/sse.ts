import { serializeEvent } from '@aicopilot/protocol';
import type { CopilotEvent } from '@aicopilot/protocol';

export const SSE_RESPONSE_HEADERS = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache',
  Connection: 'keep-alive',
} as const;

/**
 * One SSE frame per CopilotEvent. `id:` lets a spec-compliant EventSource resume via
 * Last-Event-ID; `event:` mirrors the protocol's own `type` discriminator so a plain
 * `EventSource.addEventListener(event.type, ...)` also works without parsing `data` first.
 */
export function formatSseFrame(event: CopilotEvent): string {
  return `id: ${event.id}\nevent: ${event.type}\ndata: ${serializeEvent(event)}\n\n`;
}

/** A raw SSE comment line - ignored by any spec-compliant parser, useful only for humans inspecting the raw stream. */
export function formatSseComment(message: string): string {
  return `: ${message}\n\n`;
}
