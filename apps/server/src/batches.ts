/** 決まった数ずつ並べて走らせ、入力の順で結果を返す。 */
export async function inBatches<T, R>(items: T[], size: number, run: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = []
  for (let at = 0; at < items.length; at += size) {
    results.push(...(await Promise.all(items.slice(at, at + size).map(run))))
  }
  return results
}
