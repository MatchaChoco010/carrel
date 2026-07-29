import type { IngestStore } from '../ingest/store.ts'
import type { JobQueue } from '../jobs/queue.ts'
import type { Job } from '../jobs/types.ts'
import { translatePaper, type TranslateDeps } from './run.ts'

export const TRANSLATE_JOB = 'translate'

/** 翻訳のジョブを積む。枠が尽きたときは待機に入る(0003)。 */
export function enqueueTranslate(queue: JobQueue, slug: string): Job {
  return queue.enqueue({ kind: TRANSLATE_JOB, target: slug, resource: 'codex', priority: 'foreground' })
}

export function registerTranslate(
  queue: JobQueue,
  deps: TranslateDeps & { ingests: IngestStore; onDone: (slug: string) => void },
): void {
  queue.register(TRANSLATE_JOB, async (job) => {
    const slug = job.target
    try {
      const outcomes = await translatePaper(slug, deps)
      const breached = outcomes.filter((o) => o.breach !== null)
      if (breached.length > 0) {
        // 契約に反した節は訳を採ったうえで記録する。訳が無いより、どこが原文
        // どおりでないかが分かる訳があるほうがよい。
        console.warn(
          `${slug}: ${breached.length} 節が原文のまま残すべきものを変えた: ` +
            breached.map((o) => `${o.heading || `${o.index} 番目`}(${o.breach})`).join(' / '),
        )
      }
      deps.ingests.advance(slug, 'register')
      deps.onDone(slug)
    } catch (error) {
      deps.ingests.fail(slug, error instanceof Error ? error.message : String(error))
      throw error
    }
  })
}
