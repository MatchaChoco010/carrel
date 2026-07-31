import type { Reference } from '../data/references.ts'
import { findPaper, titleIndex, type FindPaperDeps, type IndexedTitle } from '../search/find-paper.ts'

export type MatchDeps = {
  byArxivId: (arxivId: string) => string | null
  byDoi: (doi: string) => string | null
  /** 索引にある論文の題。突き合わせのたびに読み直す。 */
  titles: IndexedTitle[]
}

/**
 * 参考文献が既にコレクションにあるかを判定する。並びは入力と同じ順で、無ければ null。
 *
 * 1 本の論文が 100 件以上を挙げることがあるので、題の表は 1 度だけ作る。
 */
export function matchReferences(references: Reference[], deps: MatchDeps): Array<string | null> {
  const find: FindPaperDeps = { byArxivId: deps.byArxivId, byDoi: deps.byDoi, byTitle: titleIndex(deps.titles) }
  return references.map((reference) => findPaper(reference, find)?.slug ?? null)
}
