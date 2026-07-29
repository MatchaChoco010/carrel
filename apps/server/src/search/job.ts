import type { IngestStore } from '../ingest/store.ts'
import type { JobQueue } from '../jobs/queue.ts'
import type { Job } from '../jobs/types.ts'
import { registerPaper, type RegisterDeps } from './register.ts'

export const REGISTER_JOB = 'register'

/**
 * 登録のジョブを積む。
 *
 * 資源クラスは GPU で、変換と同時には走らない(0003)。埋め込みの生成が GPU を
 * 使うためである。
 */
export function enqueueRegister(queue: JobQueue, slug: string): Job {
  return queue.enqueue({ kind: REGISTER_JOB, target: slug, resource: 'gpu', priority: 'foreground' })
}

export function registerRegister(queue: JobQueue, deps: RegisterDeps & { ingests: IngestStore }): void {
  queue.register(REGISTER_JOB, async (job) => {
    const slug = job.target
    try {
      await registerPaper(slug, deps)
      // 全段階が成功したので、ここで初めて検索の対象になる(0004)。
      // registerPaper の最後は同期処理なので、ここまで監視の処理は割り込めない。
      deps.ingests.finish(slug)
    } catch (error) {
      deps.ingests.fail(slug, error instanceof Error ? error.message : String(error))
      throw error
    }
  })
}
