const ABORTED = Symbol('aborted');

function waitForAbort(signal: AbortSignal): Promise<typeof ABORTED> {
  if (signal.aborted) {
    return Promise.resolve(ABORTED);
  }
  return new Promise((resolve) => {
    signal.addEventListener('abort', () => resolve(ABORTED), { once: true });
  });
}

/**
 * Consumes `iterable`, yielding its values until either it completes naturally or `signal`
 * aborts - whichever happens first. On abort (or on the consumer breaking out of a
 * `for await` loop early), the source iterator's `.return()` is always called so a
 * well-behaved executor gets a chance to release its own resources (timers, sockets, etc).
 * This exists so cancellation stays prompt even against an executor that is slow to notice
 * `context.signal` on its own - see the executor module's cancellation contract.
 */
export async function* cancellable<T>(
  iterable: AsyncIterable<T>,
  signal: AbortSignal,
): AsyncGenerator<T, void, undefined> {
  // Explicitly parametrized (TReturn = void, not the default `any`) so `.next()`'s result
  // stays properly typed instead of letting `value` collapse to `any` - see
  // typescript-standards' no-`any` rule.
  const iterator = iterable[Symbol.asyncIterator]() as AsyncIterator<T, void, undefined>;
  try {
    while (true) {
      if (signal.aborted) {
        return;
      }

      const outcome = await Promise.race([iterator.next(), waitForAbort(signal)]);
      if (outcome === ABORTED) {
        return;
      }

      const { value, done } = outcome;
      if (done) {
        return;
      }
      yield value;
    }
  } finally {
    await iterator.return?.();
  }
}
