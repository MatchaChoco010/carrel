import { normalizeDoi } from '../data/doi.ts'
import type { Reference } from '../data/references.ts'
import { extractArxivId } from '../ingest/arxiv.ts'

/**
 * 題を突き合わせる形に直す。小文字にし、記号と空白を落とす(0015)。
 *
 * 参考文献の題は変換と照合を経た文字なので、句読点や綴りの飾りが原本と揃わない。
 */
export function normalizeTitle(title: string): string {
  return title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
}

export type MatchDeps = {
  byArxivId: (arxivId: string) => string | null
  byDoi: (doi: string) => string | null
  /** 索引にある論文の題。突き合わせのたびに読み直す。 */
  titles: Array<{ slug: string; title: string; year: number | null }>
}

/**
 * 参考文献が既にコレクションにあるかを判定する。並びは入力と同じ順で、無ければ null。
 *
 * 鍵は arXiv の識別子・DOI・正規化した題の順に見る。slug は使わない。slug の題由来の
 * 短い語は取り込みのときにエージェントが選ぶので、参考文献から作り直せないためである(0015)。
 */
export function matchReferences(references: Reference[], deps: MatchDeps): Array<string | null> {
  const byTitle = new Map<string, Array<{ slug: string; year: number | null }>>()
  for (const paper of deps.titles) {
    const key = normalizeTitle(paper.title)
    if (key.length === 0) continue
    const found = byTitle.get(key)
    if (found === undefined) byTitle.set(key, [{ slug: paper.slug, year: paper.year }])
    else found.push({ slug: paper.slug, year: paper.year })
  }

  return references.map((reference) => {
    const arxivId = reference.arxivId === null ? null : extractArxivId(reference.arxivId)
    if (arxivId !== null) {
      const slug = deps.byArxivId(arxivId)
      if (slug !== null) return slug
    }

    const doi = normalizeDoi(reference.doi)
    if (doi !== null) {
      const slug = deps.byDoi(doi)
      if (slug !== null) return slug
    }

    const candidates = byTitle.get(normalizeTitle(reference.title)) ?? []
    // 同じ題の別論文(改訂版と初出など)を取り違えないように、年が両方にあれば揃うものを採る。
    const matched =
      candidates.find((c) => reference.year === null || c.year === null || c.year === reference.year) ?? null
    return matched?.slug ?? null
  })
}
