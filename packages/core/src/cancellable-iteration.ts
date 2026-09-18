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
 *
 * The source generator's own return value (e.g. an Executor's ExecutorCompletion) is
 * propagated through when it finishes naturally; on abort there is no real completion value
 * to report, so `undefined` is returned instead.
 */
export async function* cancellable<T, TReturn = void>(
  iterable: AsyncIterable<T> | AsyncGenerator<T, TReturn, undefined>,
  signal: AbortSignal,
): AsyncGenerator<T, TReturn | undefined, undefined> {
  // Explicitly parametrized (not the default `any` for TReturn) so `.next()`'s result stays
  // properly typed instead of letting `value` collapse to `any` - see typescript-standards'
  // no-`any` rule.
  const iterator = iterable[Symbol.asyncIterator]() as AsyncIterator<T, TReturn, undefined>;
  try {
    while (true) {
      if (signal.aborted) {
        return undefined;
      }

      const outcome = await Promise.race([iterator.next(), waitForAbort(signal)]);
      if (outcome === ABORTED) {
        return undefined;
      }

      const { value, done } = outcome;
      if (done) {
        return value;
      }
      yield value;
    }
  } finally {
    await iterator.return?.();
  }
}
