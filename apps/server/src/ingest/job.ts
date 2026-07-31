import type { CodexClient } from '../codex/client.ts'
import type { IndexDb } from '../db/index-db.ts'
import type { JobQueue } from '../jobs/queue.ts'
import type { Job } from '../jobs/types.ts'
import { extractArxivId } from './arxiv.ts'
import type { HeadPaths } from './head.ts'
import { ingestFromUpload, ingestFromUrl, type IngestResult } from './pipeline.ts'
import { readStaged, removeStaged } from './staging.ts'
import type { IngestStore } from './store.ts'

export const RESOLVE_JOB = 'resolve'

/** 手元から預かった原本を指す仕事の対象。URL と見分けるために印を付ける。 */
const UPLOAD_PREFIX = 'upload:'

export function uploadTarget(id: string): string {
  return `${UPLOAD_PREFIX}${id}`
}

export type ResolveDeps = {
  dataDir: string
  /** 預かった原本の置き場を持つディレクトリ(0021)。 */
  stateDir: string
  /** 原本の先頭を読む道具(0021)。 */
  head: HeadPaths
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
    const result = url.startsWith(UPLOAD_PREFIX)
      ? await resolveUpload(url.slice(UPLOAD_PREFIX.length), deps)
      : await ingestFromUrl(url, {
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

/**
 * 預かった原本から取り込む。
 *
 * 取り込みが始まらなかったときも、預かった原本を置き場に残さない(0021)。取り込みが
 * 始まったときは、取得の段階がコレクションへ移した時点で置き場から無くなっている。
 */
async function resolveUpload(id: string, deps: ResolveDeps): Promise<IngestResult> {
  const staged = await readStaged(deps.stateDir, id)
  if (staged === null) throw new Error(`預かった原本が見つからない: ${id}`)

  try {
    return await ingestFromUpload(staged, {
      dataDir: deps.dataDir,
      index: deps.index,
      ingests: deps.ingests,
      codex: deps.codex,
      model: deps.model(),
      head: deps.head,
    })
  } finally {
    await removeStaged(deps.stateDir, id)
  }
}
