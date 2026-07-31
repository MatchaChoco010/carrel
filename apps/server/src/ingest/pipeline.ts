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
    doi: source.doi,
    sourceUrl,
    pdfUrl: source.originalUrl,
    tags: [],
    addedAt: nowIsoDateTime(),
  }
}

/**
 * 試す所在を順に並べる。
 *
 * arXiv の識別子が分かっていれば、その PDF を最後に足す。出版社の閲覧ページしか
 * 挙がらなかったときの受け皿になる。
 */
function candidates(source: ResolvedSource): string[] {
  const urls = [source.originalUrl, ...source.alternateUrls]
  if (source.arxivId !== null) urls.push(`https://arxiv.org/pdf/${source.arxivId}`)
  return [...new Set(urls)]
}

/**
 * 取れるところまで順に試す。
 *
 * 出版社の閲覧ページは HTTP としては成功しながら HTML を返すので、PDF の印まで見て
 * 初めて取れたと判じる。
 */
async function fetchFirst(
  dataDir: string,
  slug: string,
  urls: string[],
  kind: ResolvedSource['kind'],
): Promise<{ url: string; path: string }> {
  const failures: string[] = []
  for (const url of urls) {
    try {
      const fetched = await fetchOriginal(dataDir, slug, url, kind)
      if (kind === 'pdf') {
        const head = await readFile(fetched.path, { encoding: null })
        if (!looksLikePdf(head.subarray(0, 8))) {
          failures.push(`${url}: PDF ではない (content-type=${fetched.contentType})`)
          continue
        }
      }
      return { url, path: fetched.path }
    } catch (error) {
      failures.push(`${url}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  throw new Error(`原本を取得できなかった。試した所在:\n${failures.join('\n')}`)
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
  deps.ingests.startStage(slug, 'resolve')

  try {
    // abstract を paper.md へ書かないのは、本文を照合が確定させるためである。
    // ここへ書くと後で失われる。
    await writePaper(deps.dataDir, toMeta(slug, source, sourceUrl), '')
    if (source.abstract !== null && source.abstract.length > 0) {
      await writePaperSideFile(deps.dataDir, slug, 'abstract', source.abstract, 'en')
    }
    deps.ingests.advance(slug, 'fetch')

    const taken = await fetchFirst(deps.dataDir, slug, candidates(source), source.kind)
    // 別の所在から取れたときは、原本の場所をそこへ直す。
    if (taken.url !== source.originalUrl) {
      await writePaper(deps.dataDir, { ...toMeta(slug, source, sourceUrl), pdfUrl: taken.url }, '')
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
