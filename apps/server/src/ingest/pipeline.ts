import { access } from 'node:fs/promises'
import { readFile } from 'node:fs/promises'
import type { CodexClient } from '../codex/client.ts'
import type { Collection } from '../data/collection.ts'
import { paperFile, paperOriginalPdf } from '../data/layout.ts'
import { writePaper, type PaperMeta } from '../data/paper.ts'
import { buildSlug } from '../data/slug.ts'
import { nowIsoDateTime } from '../data/datetime.ts'
import type { IndexDb } from '../db/index-db.ts'
import { fetchOriginal, looksLikePdf } from './fetch.ts'
import { resolveSource } from './resolve.ts'
import type { IngestStage, ResolvedSource } from './types.ts'

export type IngestDeps = {
  dataDir: string
  index: IndexDb
  collection: Collection
  codex: CodexClient
  model: string
}

export type IngestResult =
  | { kind: 'imported'; slug: string; stagesRun: IngestStage[] }
  | { kind: 'duplicate'; slug: string; reason: 'arxivId' | 'sourceUrl' }

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

/**
 * 段階が完了しているかを、成果物の存在で判定する。
 *
 * 中断の理由(枠の枯渇、異常終了、再起動)に関わらず同じ判定で再開できる。
 */
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

/**
 * 解決と取得までを行う。
 *
 * 以降の段階(変換・照合・翻訳・登録)は後続の作業で足す。
 */
export async function ingestFromUrl(url: string, deps: IngestDeps): Promise<IngestResult> {
  const outcome = await resolveSource(url, {
    codex: deps.codex,
    model: deps.model,
    known: {
      byArxivId: (id) => deps.index.findByArxivId(id),
      bySourceUrl: (u) => deps.index.findBySourceUrl(u),
    },
  })

  if (outcome.kind === 'duplicate') return outcome

  const { source, sourceUrl } = outcome
  const taken = deps.index.allSlugs()
  const slug = buildSlug(
    {
      authors: source.authors,
      year: source.year,
      keyword: source.slugKeyword ?? source.title,
      identity: source.arxivId ?? source.originalUrl,
    },
    (candidate) => taken.has(candidate),
  )

  // frontmatter を先に書く。以降の段階はこのファイルの存在で再開点を判断する。
  await writePaper(deps.dataDir, toMeta(slug, source, sourceUrl), source.abstract ?? '')
  // 索引はファイル監視より先に更新する。続けて同じ論文が来たときに重複と
  // 判定できるようにするため。
  await deps.collection.refreshPaper(slug)

  const fetched = await fetchOriginal(deps.dataDir, slug, source.originalUrl, source.kind)
  if (source.kind === 'pdf') {
    const head = await readFile(fetched.path, { encoding: null })
    if (!looksLikePdf(head.subarray(0, 8))) {
      throw new Error(`PDF として取得できなかった (content-type=${fetched.contentType}): ${source.originalUrl}`)
    }
  }

  return { kind: 'imported', slug, stagesRun: ['resolve', 'fetch'] }
}
