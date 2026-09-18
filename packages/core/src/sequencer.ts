/**
 * Owns event ordering for a single run. Consumers never assign sequence numbers
 * themselves - see the protocol package's `CopilotEventBase.sequence` doc comment.
 * 1-based so `0` can never be mistaken for "not yet sequenced".
 */
export class EventSequencer {
  #next = 1;

  next(): number {
    const value = this.#next;
    this.#next += 1;
    return value;
  }
}
