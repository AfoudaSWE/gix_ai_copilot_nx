import type { ToolConcurrency } from './tool-metadata.js';

/**
 * Local, in-process concurrency policy for a batch of parallel tool calls the model
 * requested together (Section 52-53). Deliberately simple: if every call in the batch is
 * `parallel-safe` (the default), run the whole batch concurrently; if any call is `serial`
 * or `exclusive`, run the entire batch sequentially in request order. This is not a
 * distributed lock or a fine-grained scheduler - see the tool-system skill's explicit
 * "don't overbuild" guidance - it only prevents an obviously-unsafe tool from racing another
 * call in the same batch.
 */
export function planConcurrency(
  concurrencies: readonly (ToolConcurrency | undefined)[],
): 'parallel' | 'sequential' {
  const allParallelSafe = concurrencies.every(
    (concurrency) => (concurrency ?? 'parallel-safe') === 'parallel-safe',
  );
  return allParallelSafe ? 'parallel' : 'sequential';
}

/**
 * Runs one async operation per item, honoring the concurrency plan for the batch. Results
 * are always returned in the same order as `items`, regardless of which mode ran - a caller
 * correlating results back to `toolCallId`s never needs to special-case either mode.
 */
export async function runWithConcurrencyPlan<TItem, TResult>(
  items: readonly TItem[],
  concurrencyOf: (item: TItem) => ToolConcurrency | undefined,
  run: (item: TItem) => Promise<TResult>,
): Promise<readonly TResult[]> {
  const plan = planConcurrency(items.map(concurrencyOf));
  if (plan === 'parallel') {
    return Promise.all(items.map((item) => run(item)));
  }
  const results: TResult[] = [];
  for (const item of items) {
    results.push(await run(item));
  }
  return results;
}
