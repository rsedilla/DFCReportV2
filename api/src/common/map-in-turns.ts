/**
 * `fn` over `items`, at most `limit` at a time, the results in the order of `items`.
 *
 * For a request that computes several independent figures, each in its own transaction: run
 * one after another they add up, and run all at once they can take every connection in the pool
 * (ten, section 24) from one request, so other requests wait behind it.
 */
export async function mapInTurns<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await fn(items[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}
