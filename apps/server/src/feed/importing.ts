import { extractArxivId } from '../ingest/arxiv.ts'
import { RESOLVE_JOB } from '../ingest/job.ts'
import type { IngestStatus } from '../ingest/store.ts'
import type { Job } from '../jobs/types.ts'

/**
 * フィードの項目について、いま取り込みが進んでいるかを決める(#295)。
 *
 * 取り込みの記録ができるのは解決が終わって slug が決まってからなので、記録だけを見ると
 * 押した直後の数十秒が抜ける。まだ記録になっていない解決の仕事も見る(#230 の一覧と同じ)。
 */

/** まだ記録になっていない取り込みの、arXiv の識別子。 */
export function resolvingArxivIds(jobs: Job[]): Set<string> {
  const ids = new Set<string>()
  for (const job of jobs) {
    if (job.kind !== RESOLVE_JOB) continue
    const id = extractArxivId(job.target)
    if (id !== null) ids.add(id)
  }
  return ids
}

/**
 * この論文の取り込みが進んでいるか。
 *
 * 失敗したものは進んでいないとみなす。仕事の欄からやり直せるが、フィードからも押し直せる
 * ほうが手数が少ない。
 */
export function isImporting(
  arxivId: string,
  record: { status: IngestStatus } | null,
  resolving: ReadonlySet<string>,
): boolean {
  if (record !== null) return record.status === 'inProgress'
  return resolving.has(arxivId)
}
