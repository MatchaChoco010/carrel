import { access, readFile } from 'node:fs/promises'
import type { CodexClient } from '../codex/client.ts'
import { nowIsoDateTime } from '../data/datetime.ts'
import { paperFile, paperOriginalPdf } from '../data/layout.ts'
import { deletePaperDir, writePaper, writePaperSideFile, type PaperMeta } from '../data/paper.ts'
import { buildSlug } from '../data/slug.ts'
import type { IndexDb } from '../db/index-db.ts'
import { fetchOriginal, looksLikePdf } from './fetch.ts'
import { resolveSource } from './resolve.ts'
import type { IngestStore } from './store.ts'
import type { IngestStage, ResolvedSource } from './types.ts'

export type IngestDeps = {
  dataDir: string
  index: IndexDb
  ingests: IngestStore
  codex: CodexClient
  model: string
}

export type IngestResult =
  | { kind: 'imported'; slug: string; stagesRun: IngestStage[] }
  | { kind: 'duplicate'; slug: string; reason: 'arxivId' | 'sourceUrl'; state: 'imported' | 'inProgress' | 'failed' }

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

/** 段階が完了しているかを、成果物の存在で判定する。 */
export async function completedStages(dataDir: string, slug: string): Promise<Set<IngestStage>> {
  const done = new Set<IngestStage>()
  if (await exists(paperFile(dataDir, slug, 'body'))) done.add('resolve')
  if ((await exists(paperOriginalPdf(dataDir, slug))) || (await exists(paperFile(dataDir, slug, 'raw')))) {
    done.add('fetch')
  }
  if (await exists(paperFile(dataDir, slug, 'raw'))) done.add('convert')
  if (await exists(paperFile(dataDir, slug, 'verification'))) done.add('verify')
  if (await exists(paperFile(dataDir, slug, 'bodyJa'))) done.add('translate')
  return done
}

function toMeta(slug: string, source: ResolvedSource, sourceUrl: string): PaperMeta {
  return {
    slug,
    title: source.title,
    authors: source.authors,
    venue: source.venue,
    year: source.year,
    arxivId: source.arxivId,
    sourceUrl,
    pdfUrl: source.originalUrl,
    tags: [],
    addedAt: nowIsoDateTime(),
  }
}

/** 解決と取得までを行う。 */
export async function ingestFromUrl(url: string, deps: IngestDeps): Promise<IngestResult> {
  const outcome = await resolveSource(url, {
    codex: deps.codex,
    model: deps.model,
    known: {
      byArxivId: (id) => deps.index.findByArxivId(id) ?? deps.ingests.byArxivId(id)?.slug ?? null,
      bySourceUrl: (u) => deps.index.findBySourceUrl(u) ?? deps.ingests.bySourceUrl(u)?.slug ?? null,
    },
  })

  if (outcome.kind === 'duplicate') {
    const record = deps.ingests.get(outcome.slug)
    const state = record === null ? 'imported' : record.status === 'done' ? 'imported' : record.status
    return { ...outcome, state }
  }

  const { source, sourceUrl } = outcome
  const taken = new Set([...deps.index.allSlugs(), ...deps.ingests.takenSlugs()])
  const slug = buildSlug(
    {
      authors: source.authors,
      year: source.year,
      keyword: source.slugKeyword ?? source.title,
      identity: source.arxivId ?? source.originalUrl,
    },
    (candidate) => taken.has(candidate),
  )

  deps.ingests.start({
    slug,
    sourceUrl,
    arxivId: source.arxivId,
    originalUrl: source.originalUrl,
  })

  try {
    // abstract を paper.md へ書かないのは、本文を照合が確定させるためである。
    // ここへ書くと後で失われる。
    await writePaper(deps.dataDir, toMeta(slug, source, sourceUrl), '')
    if (source.abstract !== null && source.abstract.length > 0) {
      await writePaperSideFile(deps.dataDir, slug, 'abstract', source.abstract, 'en')
    }
    deps.ingests.advance(slug, 'fetch')

    const fetched = await fetchOriginal(deps.dataDir, slug, source.originalUrl, source.kind)
    if (source.kind === 'pdf') {
      const head = await readFile(fetched.path, { encoding: null })
      if (!looksLikePdf(head.subarray(0, 8))) {
        throw new Error(`PDF として取得できなかった (content-type=${fetched.contentType}): ${source.originalUrl}`)
      }
    }
    deps.ingests.advance(slug, 'convert')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    deps.ingests.fail(slug, message)
    throw error
  }

  return { kind: 'imported', slug, stagesRun: ['resolve', 'fetch'] }
}

/** 取り込みを取り消す。成果物と記録の両方を消す。 */
export async function discardIngest(dataDir: string, slug: string, ingests: IngestStore): Promise<void> {
  await deletePaperDir(dataDir, slug)
  ingests.remove(slug)
}
