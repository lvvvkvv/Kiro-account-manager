/** 固定数量的 worker 连续取任务，慢任务不会阻塞整个下一批。 */
export async function mapConcurrent<T, R>(
  items: readonly T[],
  concurrency: number,
  run: (item: T, index: number) => Promise<R>
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length)
  let next = 0
  const workers = Math.min(items.length, Math.max(1, Math.floor(concurrency) || 1))
  await Promise.all(
    Array.from({ length: workers }, async () => {
      while (next < items.length) {
        const index = next++
        try {
          results[index] = { status: 'fulfilled', value: await run(items[index], index) }
        } catch (reason) {
          results[index] = { status: 'rejected', reason }
        }
      }
    })
  )
  return results
}
