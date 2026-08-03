import { access, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { paperOriginalHtml, paperOriginalPdf } from '../data/layout.ts'
import { readPaper } from '../data/paper.ts'
import type { IngestStore } from '../ingest/store.ts'
import type { JobQueue } from '../jobs/queue.ts'
import type { Job } from '../jobs/types.ts'
import { runConverter, runHtmlConverter, type ConverterPaths } from './runner.ts'
import { storeConversion } from './store.ts'

export const CONVERT_JOB = 'convert'

export type ConvertDeps = {
  dataDir: string
  ingests: IngestStore
  paths: ConverterPaths
  /** HTML の原本を変換する script(0022)。 */
  htmlScript: string
  /** 次の段階を積む。 */
  onDone: (slug: string) => void
}

/**
 * 変換のジョブを積む。
 *
 * PDF の原本は変換器を GPU で走らせるので、資源クラスは GPU にする。同時実行は 1 に
 * 制限され、埋め込みの生成とも同時に走らない(0003)。
 *
 * HTML の原本は GPU を使わず、図の画像を落とすぶんだけ通信するので network にする(0022)。
 */
export function enqueueConvert(queue: JobQueue, slug: string, kind: OriginalKind = 'pdf', orderKey?: number): Job {
  return queue.enqueue({
    kind: CONVERT_JOB,
    target: slug,
    resource: kind === 'html' ? 'network' : 'gpu',
    priority: 'foreground',
    orderKey,
  })
}

export type OriginalKind = 'pdf' | 'html'

/** 置いてある原本の種別を見る。どちらも無ければ null。 */
export async function originalKind(dataDir: string, slug: string): Promise<OriginalKind | null> {
  if (await exists(paperOriginalPdf(dataDir, slug))) return 'pdf'
  if (await exists(paperOriginalHtml(dataDir, slug))) return 'html'
  return null
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

export function registerConvert(queue: JobQueue, deps: ConvertDeps): void {
  queue.register(CONVERT_JOB, async (job) => {
    const slug = job.target
    deps.ingests.beginStage(slug, 'convert')
    const work = await mkdtemp(join(tmpdir(), `pct-convert-${slug}-`))
    try {
      const kind = await originalKind(deps.dataDir, slug)
      if (kind === null) throw new Error(`原本が見つからない: ${slug}`)

      const document =
        kind === 'pdf'
          ? await runConverter({ pdf: paperOriginalPdf(deps.dataDir, slug), outDir: work, paths: deps.paths })
          : await runHtmlConverter({
              html: paperOriginalHtml(deps.dataDir, slug),
              // 図の相対の場所は、原本を取った場所から解く。
              baseUrl: (await readPaper(deps.dataDir, slug))?.meta.pdfUrl ?? null,
              outDir: work,
              paths: { python: deps.paths.python, script: deps.htmlScript },
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
