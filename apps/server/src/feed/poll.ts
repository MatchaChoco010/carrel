import { fetchCategory, type FetchFeedOptions } from './arxiv.ts'
import type { FeedStore } from './store.ts'

export type PollDeps = {
  feed: FeedStore
  categories: string[]
  /** 取得位置の記録が無いときに遡る日数。 */
  initialLookbackDays: number
  now?: () => number
} & FetchFeedOptions

export type PollResult = {
  category: string
  fetched: number
  added: number
}

/**
 * 設定されたカテゴリを順に取る。
 *
 * 起点は、そのカテゴリについて最後まで取れた投稿時刻である。何日止めていても、
 * 次に動いたときにその期間の投稿がまとめて入る(0004)。
 *
 * 起点を進めるのは、取れた項目のうち最も新しい投稿時刻までにとどめる。現在時刻
 * まで進めると、途中で失敗した場合に取り逃した期間が二度と取れなくなる。
 */
export async function pollFeed(deps: PollDeps): Promise<PollResult[]> {
  const now = deps.now ?? (() => Date.now())
  const to = new Date(now())
  const results: PollResult[] = []

  for (const category of deps.categories) {
    const cursor = deps.feed.cursor(category)
    const from = new Date(cursor ?? now() - deps.initialLookbackDays * 24 * 60 * 60 * 1000)

    const entries = await fetchCategory(category, from, to, deps)
    const added = deps.feed.add(entries)
    if (entries.length > 0) {
      deps.feed.setCursor(category, Math.max(...entries.map((e) => e.publishedAt)))
    }
    results.push({ category, fetched: entries.length, added })
  }
  return results
}
