import type { IngestStore } from '../ingest/store.ts'
import type { JobQueue } from '../jobs/queue.ts'
import type { Job } from '../jobs/types.ts'
import { registerPaper, type RegisterDeps } from './register.ts'

export const REGISTER_JOB = 'register'

/**
 * 埋め込みの作り直し。
 *
 * 索引を作り直すと論文のチャンクは消えるが、走査は markdown を読み直すだけで
 * 埋め込みを作らない。取り込みの登録と処理は同じだが、取り込みの状態には触らない。
 * 既に取り込みが終わった論文をここで失敗にすると、直っていない不具合として見える。
 */
export const EMBED_JOB = 'embed'

/** 埋め込みの作り直しを積む。ユーザーは結果を待っていないので背景で走らせる(0003)。 */
export function enqueueEmbed(queue: JobQueue, slug: string): Job {
  return queue.enqueue({ kind: EMBED_JOB, target: slug, resource: 'gpu', priority: 'background' })
}

export function registerEmbed(queue: JobQueue, deps: RegisterDeps): void {
  queue.register(EMBED_JOB, async (job) => {
    await registerPaper(job.target, deps)
  })
}

/**
 * 登録のジョブを積む。
 *
 * 資源クラスは GPU で、変換と同時には走らない(0003)。埋め込みの生成が GPU を
 * 使うためである。
 */
export function enqueueRegister(queue: JobQueue, slug: string): Job {
  return queue.enqueue({ kind: REGISTER_JOB, target: slug, resource: 'gpu', priority: 'foreground' })
}

export function registerRegister(
  queue: JobQueue,
  deps: RegisterDeps & { ingests: IngestStore; onDone: (slug: string) => void },
): void {
  queue.register(REGISTER_JOB, async (job) => {
    const slug = job.target
    try {
      await registerPaper(slug, deps)
      // 全段階が成功したので、ここで初めて検索の対象になる(0004)。
      // registerPaper の最後は同期処理なので、ここまで監視の処理は割り込めない。
      deps.ingests.finish(slug)
      deps.onDone(slug)
    } catch (error) {
      deps.ingests.fail(slug, error instanceof Error ? error.message : String(error))
      throw error
    }
  })
}
