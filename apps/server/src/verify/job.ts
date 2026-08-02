import { access, readFile } from 'node:fs/promises'
import { paperFile, paperOriginalPdf } from '../data/layout.ts'
import { readPaper, writePaper } from '../data/paper.ts'
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

export function registerVerify(
  queue: JobQueue,
  deps: VerifyDeps & { ingests: IngestStore; onDone: (slug: string) => void },
): void {
  queue.register(VERIFY_JOB, async (job) => {
    const slug = job.target
    try {
      // 原本が HTML の論文はページ画像を作れないため、この段階を飛ばす(0004、0022)。
      // 飛ばすときは、変換の結果をそのまま本文にする。照合が本文を確定させる役目も
      // 担っているので、飛ばしたままだと本文が空のまま先へ進む。
      if (!(await exists(paperOriginalPdf(deps.dataDir, slug)))) {
        await useConvertedBody(deps.dataDir, slug)
        if (deps.ingests.advance(slug, 'bibliography')) deps.onDone(slug)
        return
      }
      await verifyPaper(slug, deps)
      if (deps.ingests.advance(slug, 'bibliography')) deps.onDone(slug)
    } catch (error) {
      deps.ingests.fail(slug, error instanceof Error ? error.message : String(error))
      throw error
    }
  })
}

/** 変換の結果を本文にする。照合を飛ばす論文で使う(0022)。 */
async function useConvertedBody(dataDir: string, slug: string): Promise<void> {
  const paper = await readPaper(dataDir, slug)
  if (paper === null) throw new Error(`論文が読めない: ${slug}`)
  const raw = await readFile(paperFile(dataDir, slug, 'raw'), 'utf8')
  await writePaper(dataDir, paper.meta, raw)
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}
