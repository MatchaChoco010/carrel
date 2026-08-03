import type { IngestStore } from '../ingest/store.ts'
import type { JobQueue } from '../jobs/queue.ts'
import type { Job, Priority } from '../jobs/types.ts'
import { structureReferences, type ReferencesDeps } from './run.ts'

export const REFERENCES_JOB = 'references'

/**
 * 参考文献の段階を積む。
 *
 * 取り込みの途中で積むときは、その論文が読めるようになるまでの行程の一部なので
 * 前面で走らせる。取り込みが終わった論文へ積み直すときは背景で走らせる。
 */
export function enqueueReferences(queue: JobQueue, slug: string, priority: Priority = 'foreground', orderKey?: number): Job {
  return queue.enqueue({ kind: REFERENCES_JOB, target: slug, resource: 'codex', priority, orderKey })
}

export function registerReferences(
  queue: JobQueue,
  deps: ReferencesDeps & { ingests: IngestStore; onDone: (slug: string) => void },
): void {
  queue.register(REFERENCES_JOB, async (job) => {
    const slug = job.target
    // 取り込みの途中で走ったときだけ、取り込みの状態を動かす。積み直しでは、
    // 終わっている取り込みを途中の状態へ戻さない。
    const record = deps.ingests.get(slug)
    const inChain = record !== null && record.status === 'inProgress'
    if (!inChain) deps.ingests.startStage(slug, 'references')

    try {
      await structureReferences(slug, deps)
    } catch (error) {
      if (inChain) deps.ingests.fail(slug, error instanceof Error ? error.message : String(error))
      throw error
    }

    if (!inChain) {
      deps.ingests.finishStage(slug, 'references')
      return
    }
    // 走っている間に取り込みが失敗していたら、ここで終える(#289)。始まった時点の
    // `inChain` のまま進めると、失敗した記録の上を段階が進む。
    if (deps.ingests.advance(slug, 'register')) deps.onDone(slug)
  })
}
