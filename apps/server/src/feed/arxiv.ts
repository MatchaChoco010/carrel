import { extractArxivId, parseArxivEntries, type Fetcher } from '../ingest/arxiv.ts'
import type { FeedEntry } from './types.ts'

/** 1 回の問い合わせで取る件数。小さく刻むほど、応答が壊れたときの取り直しが軽い。 */
const PAGE_SIZE = 100

/** 問い合わせの間に空ける時間。arXiv は 3 秒以上空けることを求めている。 */
const INTERVAL_MS = 3000

/** 1 回の取得で辿るページ数の上限。長く止めていても、1 回の取得を有限で終える。 */
const MAX_PAGES = 20

/** arXiv の投稿日時の書式(`YYYYMMDDHHMM`)。 */
function stamp(at: Date): string {
  const p = (n: number, width = 2): string => String(n).padStart(width, '0')
  return `${p(at.getUTCFullYear(), 4)}${p(at.getUTCMonth() + 1)}${p(at.getUTCDate())}${p(at.getUTCHours())}${p(at.getUTCMinutes())}`
}

export function buildSearchUrl(category: string, from: Date, to: Date, start: number): string {
  const query = `cat:${category} AND submittedDate:[${stamp(from)} TO ${stamp(to)}]`
  const params = new URLSearchParams({
    search_query: query,
    start: String(start),
    max_results: String(PAGE_SIZE),
    sortBy: 'submittedDate',
    sortOrder: 'ascending',
  })
  return `https://export.arxiv.org/api/query?${params.toString()}`
}

export type FetchFeedOptions = {
  fetcher?: Fetcher
  /** 問い合わせの間に待つ。試験では差し替える。 */
  wait?: (ms: number) => Promise<void>
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * 1 つのカテゴリについて、指定した期間の投稿を取る。
 *
 * 投稿日時の昇順で辿るので、途中で失敗しても、そこまでに得た項目の最後の投稿
 * 時刻を次回の起点にできる。
 */
export async function fetchCategory(
  category: string,
  from: Date,
  to: Date,
  options: FetchFeedOptions = {},
): Promise<FeedEntry[]> {
  const fetcher = options.fetcher ?? globalThis.fetch
  const wait = options.wait ?? sleep

  const entries: FeedEntry[] = []
  for (let page = 0; page < MAX_PAGES; page += 1) {
    if (page > 0) await wait(INTERVAL_MS)

    const response = await fetcher(buildSearchUrl(category, from, to, page * PAGE_SIZE))
    if (!response.ok) break

    const parsed = parseArxivEntries(await response.text())
    for (const entry of parsed) {
      const arxivId = entry.id === null ? null : extractArxivId(entry.id)
      if (arxivId === null || entry.published === null) continue
      entries.push({
        arxivId,
        category,
        title: entry.title ?? arxivId,
        authors: entry.authors,
        abstract: entry.abstract,
        publishedAt: Date.parse(entry.published),
      })
    }
    if (parsed.length < PAGE_SIZE) break
  }
  return entries
}
