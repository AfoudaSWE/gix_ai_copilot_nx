import { CopilotError } from '@gixcopilot/protocol';
import type { ModelToolCall } from './model-stream-event.js';

/**
 * One fragment of a streamed tool call, in a provider-neutral shape (Section 38). Providers
 * that stream function-call arguments as incremental JSON string chunks (e.g. OpenAI) map
 * their own per-chunk shape onto this one; a provider that always delivers a tool call in a
 * single chunk has no need for this assembler at all.
 */
export interface ToolCallDeltaFragment {
  /** Stable position within the model's tool-call list for this turn - fragments for the
   * same call always share the same index, even before an `id`/`name` has arrived. */
  readonly index: number;
  readonly id?: string;
  readonly name?: string;
  /** A fragment of the arguments JSON string - never assumed to be valid JSON on its own. */
  readonly argumentsDelta?: string;
}

/**
 * Accumulates fragmented tool-call deltas (Section 38) and finalizes them into fully-parsed
 * `ModelToolCall`s once the provider signals the stream is done. Order-preserving by index.
 */
export class ToolCallAssembler {
  #byIndex = new Map<number, { id?: string; name?: string; argumentsJson: string }>();

  push(fragment: ToolCallDeltaFragment): void {
    const existing = this.#byIndex.get(fragment.index) ?? { argumentsJson: '' };
    this.#byIndex.set(fragment.index, {
      id: fragment.id ?? existing.id,
      name: fragment.name ?? existing.name,
      argumentsJson: existing.argumentsJson + (fragment.argumentsDelta ?? ''),
    });
  }

  /**
   * Parses accumulated argument JSON for every fragment seen so far, in index order. Throws
   * a validation error naming which call failed to parse, rather than silently dropping it -
   * a malformed tool call must never be silently ignored (see the security skill's zero-
   * trust-for-model-output rule).
   */
  finalize(): readonly ModelToolCall[] {
    const indices = Array.from(this.#byIndex.keys()).sort((a, b) => a - b);
    return indices.map((index) => {
      const entry = this.#byIndex.get(index);
      /* c8 ignore next 3 - unreachable: `index` came from this same map's own keys */
      if (!entry) {
        throw CopilotError.internal(`Missing tool-call fragment state at index ${index}.`);
      }
      if (!entry.id || !entry.name) {
        throw CopilotError.validation(
          `Incomplete tool call at index ${index}: missing id or name.`,
          { index },
        );
      }
      let parsedArguments: unknown;
      try {
        parsedArguments = entry.argumentsJson.trim() === '' ? {} : JSON.parse(entry.argumentsJson);
      } catch {
        throw CopilotError.validation(
          `Tool call "${entry.name}" arguments were not valid JSON.`,
          { name: entry.name },
        );
      }
      if (typeof parsedArguments !== 'object' || parsedArguments === null) {
        throw CopilotError.validation(
          `Tool call "${entry.name}" arguments must be a JSON object.`,
          { name: entry.name },
        );
      }
      return {
        id: entry.id,
        name: entry.name,
        arguments: parsedArguments as Readonly<Record<string, unknown>>,
      };
    });
  }

  get isEmpty(): boolean {
    return this.#byIndex.size === 0;
  }
}
