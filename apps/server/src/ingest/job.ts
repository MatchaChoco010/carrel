import type { CodexClient } from '../codex/client.ts'
import type { IndexDb } from '../db/index-db.ts'
import type { JobQueue } from '../jobs/queue.ts'
import type { Job } from '../jobs/types.ts'
import { extractArxivId } from './arxiv.ts'
import { ingestFromUrl } from './pipeline.ts'
import type { IngestStore } from './store.ts'

export const RESOLVE_JOB = 'resolve'

export type ResolveDeps = {
  dataDir: string
  index: IndexDb
  ingests: IngestStore
  codex: CodexClient
  /** 解決に使う Codex のモデル。設定は動いている間に変わりうる。 */
  model: () => string
  /** 解決と取得が済んだ論文の、残りの段階を始める。 */
  onImported: (slug: string) => void
  /** フィードから取り込んだ論文を結びつける。同じ論文を二度取り込ませないため。 */
  linkFeed: (arxivId: string, slug: string) => void
}

/**
 * 解決と取得を積む。
 *
 * 押した時点では論文が何かも分からないので、仕事の対象は URL である。slug が決まるのは
 * 解決の後で、そこから先の段階は slug で追う(0004)。
 */
export function enqueueResolve(queue: JobQueue, url: string): Job {
  return queue.enqueue({ kind: RESOLVE_JOB, target: url, resource: 'codex', priority: 'foreground' })
}

export function registerResolve(queue: JobQueue, deps: ResolveDeps): void {
  queue.register(RESOLVE_JOB, async (job) => {
    const url = job.target
    const result = await ingestFromUrl(url, {
      dataDir: deps.dataDir,
      index: deps.index,
      ingests: deps.ingests,
      codex: deps.codex,
      model: deps.model(),
    })

    const arxivId = extractArxivId(url)
    if (arxivId !== null) deps.linkFeed(arxivId, result.slug)
    if (result.kind === 'imported') {
      deps.onImported(result.slug)
      return
    }

    // 前の取り込みが失敗した URL は、解決の側からは重複に見える。仕事も失敗にして、
    // 一覧で理由が読めるようにする。
    if (result.state === 'failed') {
      const record = deps.ingests.get(result.slug)
      throw new Error(record?.lastError ?? `前の取り込みが失敗している: ${result.slug}`)
    }
  })
}
