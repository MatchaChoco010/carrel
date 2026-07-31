import type { IndexDb } from '../db/index-db.ts'
import { extractArxivId } from './arxiv.ts'
import type { IngestStore } from './store.ts'

export type KnownPaper = {
  slug: string
  /** 取り込みがどこまで進んでいるか。取り込み済みか、途中か、失敗している。 */
  state: 'imported' | 'inProgress' | 'failed'
}

/**
 * 取り込みを積む前に分かる重複を引く。
 *
 * 見るのは出所の URL と arXiv の識別子だけである。題名で指された論文が同じかどうかは
 * 解決の仕事が確かめる(0004)。
 */
export function knownPaper(target: string, deps: { index: IndexDb; ingests: IngestStore }): KnownPaper | null {
  const arxivId = extractArxivId(target)
  const slug =
    deps.index.findBySourceUrl(target) ??
    deps.ingests.bySourceUrl(target)?.slug ??
    (arxivId === null ? null : (deps.index.findByArxivId(arxivId) ?? deps.ingests.byArxivId(arxivId)?.slug ?? null))
  if (slug === null) return null

  const record = deps.ingests.get(slug)
  return { slug, state: record === null || record.status === 'done' ? 'imported' : record.status }
}
