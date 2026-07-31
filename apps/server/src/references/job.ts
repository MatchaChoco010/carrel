import type { IngestStore } from '../ingest/store.ts'
import type { JobQueue } from '../jobs/queue.ts'
import type { Job } from '../jobs/types.ts'
import { structureReferences, type ReferencesDeps } from './run.ts'

export const REFERENCES_JOB = 'references'

/**
 * 参考文献の段階を積む。
 *
 * 登録の後に走るので、論文は既に読める。ユーザーは結果を待っていないので背景で
 * 走らせる(0003)。
 */
export function enqueueReferences(queue: JobQueue, slug: string): Job {
  return queue.enqueue({ kind: REFERENCES_JOB, target: slug, resource: 'codex', priority: 'background' })
}

/**
 * 参考文献の段階を登録する。
 *
 * 失敗しても取り込みを失敗にしない。本文と訳と索引が揃えば論文は読めるので、
 * 参考文献が無いことは論文の使用を妨げない(0015)。積み直しは仕事の一覧から行う。
 */
export function registerReferences(queue: JobQueue, deps: ReferencesDeps & { ingests: IngestStore }): void {
  queue.register(REFERENCES_JOB, async (job) => {
    const slug = job.target
    deps.ingests.startStage(slug, 'references')
    await structureReferences(slug, deps)
    deps.ingests.finishStage(slug, 'references')
  })
}
