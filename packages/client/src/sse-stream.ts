import { parseEvent } from '@gixcopilot/protocol';
import type { CopilotEvent } from '@gixcopilot/protocol';
import { CopilotError } from '@gixcopilot/protocol';

/**
 * Parses a raw SSE byte stream into CopilotEvents. Frames with an unrecognized `type` are
 * silently skipped (forward compatibility - see the protocol package's ParsedEvent docs);
 * a frame that fails validation outright throws, ending the stream with an error rather
 * than yielding something malformed.
 */
export async function* parseSseStream(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<CopilotEvent, void, undefined> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        return;
      }
      buffer += decoder.decode(value, { stream: true });

      let frameBreak = buffer.indexOf('\n\n');
      while (frameBreak !== -1) {
        const rawFrame = buffer.slice(0, frameBreak);
        buffer = buffer.slice(frameBreak + 2);

        const event = parseSseFrame(rawFrame);
        if (event) {
          yield event;
        }

        frameBreak = buffer.indexOf('\n\n');
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

function parseSseFrame(rawFrame: string): CopilotEvent | undefined {
  if (rawFrame.length === 0 || rawFrame.startsWith(':')) {
    return undefined;
  }

  const dataLines = rawFrame.split('\n').filter((line) => line.startsWith('data:'));
  if (dataLines.length === 0) {
    return undefined;
  }

  const dataText = dataLines.map((line) => line.slice('data:'.length).replace(/^ /, '')).join('\n');

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(dataText);
  } catch {
    throw CopilotError.protocol('Received a malformed SSE data payload (invalid JSON)');
  }

  const result = parseEvent(parsedJson);
  switch (result.kind) {
    case 'known':
      return result.event;
    case 'unknown':
      return undefined;
    case 'invalid':
      throw result.error;
  }
}
