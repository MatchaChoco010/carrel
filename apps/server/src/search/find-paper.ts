import { normalizeDoi } from '../data/doi.ts'
import { extractArxivId } from '../ingest/arxiv.ts'

/**
 * 題を突き合わせる形に直す。小文字にし、記号と空白を落とす(0015)。
 *
 * 参考文献の題も web から拾った題も、句読点や綴りの飾りがコレクションの題と揃わない。
 */
export function normalizeTitle(title: string): string {
  return title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
}

/** 1 本の論文を指す鍵。どれか 1 つでも当たれば同じ論文とみなす。 */
export type PaperKey = {
  title?: string | null
  /** 題が同じ別の論文(改訂版と初出など)を切り分けるために添える。 */
  year?: number | null
  arxivId?: string | null
  doi?: string | null
}

export type IndexedTitle = { slug: string; title: string; year: number | null }

export type FindPaperDeps = {
  byArxivId: (arxivId: string) => string | null
  byDoi: (doi: string) => string | null
  /** 題で引く表。`titleIndex` で作る。 */
  byTitle: Map<string, IndexedTitle[]>
}

/** 索引の題から、正規化した題で引ける表を作る。何件も突き合わせるときに使い回す。 */
export function titleIndex(titles: IndexedTitle[]): Map<string, IndexedTitle[]> {
  const byTitle = new Map<string, IndexedTitle[]>()
  for (const paper of titles) {
    const key = normalizeTitle(paper.title)
    if (key.length === 0) continue
    const found = byTitle.get(key)
    if (found === undefined) byTitle.set(key, [paper])
    else found.push(paper)
  }
  return byTitle
}

/**
 * コレクションに同じ論文があるかを引く。
 *
 * 鍵は arXiv の識別子・DOI・正規化した題の順に見る。slug は使わない。slug の題由来の
 * 短い語は取り込みのときにエージェントが選ぶので、題から作り直せないためである(0015)。
 */
export function findPaper(key: PaperKey, deps: FindPaperDeps): { slug: string; title: string } | null {
  const arxivId = key.arxivId === null || key.arxivId === undefined ? null : extractArxivId(key.arxivId)
  if (arxivId !== null) {
    const slug = deps.byArxivId(arxivId)
    if (slug !== null) return { slug, title: key.title ?? slug }
  }

  const doi = normalizeDoi(key.doi ?? null)
  if (doi !== null) {
    const slug = deps.byDoi(doi)
    if (slug !== null) return { slug, title: key.title ?? slug }
  }

  if (key.title === null || key.title === undefined) return null
  const candidates = deps.byTitle.get(normalizeTitle(key.title)) ?? []
  // 同じ題の別論文を取り違えないように、年が両方にあれば揃うものだけを採る。
  const matched = candidates.find(
    (c) => key.year === null || key.year === undefined || c.year === null || c.year === key.year,
  )
  return matched === undefined ? null : { slug: matched.slug, title: matched.title }
}
