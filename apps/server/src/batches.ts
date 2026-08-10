/** 走っている仕事を止めたときに投げる(#329)。 */
export class Stopped extends Error {
  constructor() {
    super('止めた')
    this.name = 'Stopped'
  }
}

/**
 * 決まった数ずつ並べて走らせ、入力の順で結果を返す。
 *
 * `signal` を渡すと、束の切れ目で止まって {@link Stopped} を投げる。飛んでいる最中の
 * 束は待つので、止まるまでにその束のぶんだけかかる(#329)。
 */
export async function inBatches<T, R>(
  items: T[],
  size: number,
  run: (item: T) => Promise<R>,
  signal?: AbortSignal,
): Promise<R[]> {
  const results: R[] = []
  for (let at = 0; at < items.length; at += size) {
    if (signal?.aborted === true) throw new Stopped()
    results.push(...(await Promise.all(items.slice(at, at + size).map(run))))
  }
  if (signal?.aborted === true) throw new Stopped()
  return results
}
