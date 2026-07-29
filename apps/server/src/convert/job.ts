import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { paperOriginalPdf } from '../data/layout.ts'
import type { IngestStore } from '../ingest/store.ts'
import type { JobQueue } from '../jobs/queue.ts'
import type { Job } from '../jobs/types.ts'
import { runConverter, type ConverterPaths } from './runner.ts'
import { storeConversion } from './store.ts'

export const CONVERT_JOB = 'convert'

export type ConvertDeps = {
  dataDir: string
  ingests: IngestStore
  paths: ConverterPaths
  /** 次の段階を積む。取り込みは段階の連なりとして進む(0004)。 */
  onDone: (slug: string) => void
}

/**
 * 変換のジョブを積む。
 *
 * 資源クラスは GPU で、同時実行は 1 に制限される(0003)。埋め込みの生成と
 * 同時には走らない。
 */
export function enqueueConvert(queue: JobQueue, slug: string): Job {
  return queue.enqueue({ kind: CONVERT_JOB, target: slug, resource: 'gpu', priority: 'foreground' })
}

export function registerConvert(queue: JobQueue, deps: ConvertDeps): void {
  queue.register(CONVERT_JOB, async (job) => {
    const slug = job.target
    const work = await mkdtemp(join(tmpdir(), `pct-convert-${slug}-`))
    try {
      const document = await runConverter({
        pdf: paperOriginalPdf(deps.dataDir, slug),
        outDir: work,
        paths: deps.paths,
      })
      await storeConversion(deps.dataDir, slug, work, document)
      deps.ingests.advance(slug, 'verify')
      deps.onDone(slug)
    } catch (error) {
      deps.ingests.fail(slug, error instanceof Error ? error.message : String(error))
      throw error
    } finally {
      await rm(work, { recursive: true, force: true })
    }
  })
}
