import { access } from 'node:fs/promises'
import { paperFile } from '../data/layout.ts'
import type { IngestStore } from '../ingest/store.ts'
import type { JobQueue } from '../jobs/queue.ts'
import type { Job } from '../jobs/types.ts'
import { verifyPaper, type VerifyDeps } from './run.ts'

export const VERIFY_JOB = 'verify'

/**
 * 照合のジョブを積む。
 *
 * 資源クラスは Codex で、枠が尽きたときは待機に入る(0003)。
 */
export function enqueueVerify(queue: JobQueue, slug: string): Job {
  return queue.enqueue({ kind: VERIFY_JOB, target: slug, resource: 'codex', priority: 'foreground' })
}

export function registerVerify(queue: JobQueue, deps: VerifyDeps & { ingests: IngestStore }): void {
  queue.register(VERIFY_JOB, async (job) => {
    const slug = job.target
    try {
      // 原本が HTML の論文はページ画像を作れないため、この段階を飛ばす(0004)。
      if (!(await exists(paperFile(deps.dataDir, slug, 'raw')))) {
        deps.ingests.advance(slug, 'translate')
        return
      }
      await verifyPaper(slug, deps)
      deps.ingests.advance(slug, 'translate')
    } catch (error) {
      deps.ingests.fail(slug, error instanceof Error ? error.message : String(error))
      throw error
    }
  })
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}
