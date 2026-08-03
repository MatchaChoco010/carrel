import type { IngestStore } from '../ingest/store.ts'
import type { JobQueue } from '../jobs/queue.ts'
import type { Job } from '../jobs/types.ts'
import { lookupBibliography, type BibliographyDeps } from './run.ts'

export const BIBLIOGRAPHY_JOB = 'bibliography'

/**
 * 書誌の段階を積む。
 *
 * 資源クラスは Codex で、枠が尽きたときは待機に入る(0003)。
 */
export function enqueueBibliography(queue: JobQueue, slug: string, orderKey?: number): Job {
  return queue.enqueue({ kind: BIBLIOGRAPHY_JOB, target: slug, resource: 'codex', priority: 'foreground', orderKey })
}

export function registerBibliography(
  queue: JobQueue,
  deps: BibliographyDeps & { ingests: IngestStore; onDone: (slug: string) => void },
): void {
  queue.register(BIBLIOGRAPHY_JOB, async (job) => {
    const slug = job.target
    // 確かめられなくても取り込みは進める。学会名が空でも論文は読める(0020)。
    try {
      await lookupBibliography(slug, deps)
    } catch (error) {
      console.log(`書誌を確かめられなかった: ${slug}: ${error instanceof Error ? error.message : String(error)}`)
    }
    if (deps.ingests.advance(slug, 'translate')) deps.onDone(slug)
  })
}
