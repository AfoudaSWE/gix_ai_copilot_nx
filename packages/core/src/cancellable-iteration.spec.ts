import { describe, expect, it, vi } from 'vitest';
import { cancellable } from './cancellable-iteration.js';

function createFakeIterable(values: readonly number[]) {
  const returnSpy = vi.fn();
  const iterable: AsyncIterable<number> = {
    [Symbol.asyncIterator]() {
      let index = 0;
      return {
        next(): Promise<IteratorResult<number>> {
          if (index >= values.length) {
            return Promise.resolve({ value: undefined, done: true });
          }
          const value = values[index];
          index += 1;
          if (value === undefined) {
            return Promise.resolve({ value: undefined, done: true });
          }
          return Promise.resolve({ value, done: false });
        },
        return(value?: unknown): Promise<IteratorResult<number>> {
          returnSpy();
          return Promise.resolve({ value: value as number, done: true });
        },
      };
    },
  };
  return { iterable, returnSpy };
}

describe('cancellable', () => {
  it('yields every value when never aborted', async () => {
    const { iterable } = createFakeIterable([1, 2, 3]);
    const controller = new AbortController();
    const results: number[] = [];
    for await (const value of cancellable(iterable, controller.signal)) {
      results.push(value);
    }
    expect(results).toEqual([1, 2, 3]);
  });

  it('yields nothing if already aborted before iteration starts', async () => {
    const { iterable } = createFakeIterable([1, 2, 3]);
    const controller = new AbortController();
    controller.abort();
    const results: number[] = [];
    for await (const value of cancellable(iterable, controller.signal)) {
      results.push(value);
    }
    expect(results).toEqual([]);
  });

  it('stops as soon as the consumer aborts mid-stream and cleans up the source iterator', async () => {
    const { iterable, returnSpy } = createFakeIterable([1, 2, 3, 4, 5]);
    const controller = new AbortController();
    const results: number[] = [];

    for await (const value of cancellable(iterable, controller.signal)) {
      results.push(value);
      if (value === 2) {
        controller.abort();
      }
    }

    expect(results).toEqual([1, 2]);
    expect(returnSpy).toHaveBeenCalledTimes(1);
  });

  it('returns promptly - without waiting for a hung source iterator - once aborted', async () => {
    const returnSpy = vi.fn();
    const hungIterable: AsyncIterable<number> = {
      [Symbol.asyncIterator]() {
        return {
          next: (): Promise<IteratorResult<number>> => new Promise(() => undefined),
          return(value?: unknown): Promise<IteratorResult<number>> {
            returnSpy();
            return Promise.resolve({ value: value as number, done: true });
          },
        };
      },
    };

    const controller = new AbortController();
    const consumed = (async () => {
      const results: number[] = [];
      for await (const value of cancellable(hungIterable, controller.signal)) {
        results.push(value);
      }
      return results;
    })();

    controller.abort();
    const results = await consumed;

    expect(results).toEqual([]);
    expect(returnSpy).toHaveBeenCalledTimes(1);
  });
});
