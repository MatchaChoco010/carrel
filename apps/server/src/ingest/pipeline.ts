import { access, copyFile, mkdir, readFile, rename, rm } from 'node:fs/promises'
import type { CodexClient } from '../codex/client.ts'
import { nowIsoDateTime } from '../data/datetime.ts'
import { paperDir, paperFile, paperOriginalHtml, paperOriginalPdf } from '../data/layout.ts'
import { deletePaperDir, writePaper, writePaperSideFile, type PaperMeta } from '../data/paper.ts'
import { buildSlug } from '../data/slug.ts'
import type { IndexDb } from '../db/index-db.ts'
import { fetchOriginal, looksLikePdf } from './fetch.ts'
import { readOriginalHead, type HeadPaths } from './head.ts'
import { findMoreSources, resolveFromOriginal, resolveSource } from './resolve.ts'
import type { StagedOriginal } from './staging.ts'
import type { IngestRecord, IngestStore } from './store.ts'
import type { IngestStage, ResolvedSource } from './types.ts'

export type IngestDeps = {
  dataDir: string
  index: IndexDb
  ingests: IngestStore
  codex: CodexClient
  model: string
}

export type UploadIngestDeps = IngestDeps & {
  /** 原本の先頭を読む道具(0021)。 */
  head: HeadPaths
}

export type IngestResult =
  | { kind: 'imported'; slug: string; stagesRun: IngestStage[] }
  | {
      kind: 'duplicate'
      slug: string
      reason: 'arxivId' | 'sourceUrl' | 'title'
      state: 'imported' | 'inProgress' | 'failed'
    }

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
  if (
    (await exists(paperOriginalPdf(dataDir, slug))) ||
    (await exists(paperOriginalHtml(dataDir, slug))) ||
    (await exists(paperFile(dataDir, slug, 'raw')))
  ) {
    done.add('fetch')
  }
  if (await exists(paperFile(dataDir, slug, 'raw'))) done.add('convert')
  if (await exists(paperFile(dataDir, slug, 'verification'))) done.add('verify')
  if (await exists(paperFile(dataDir, slug, 'bodyJa'))) done.add('translate')
  if (await exists(paperFile(dataDir, slug, 'references'))) done.add('references')
  return done
}

function toMeta(slug: string, source: ResolvedSource, sourceUrl: string | null): PaperMeta {
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
  const urls = [...(source.originalUrl === null ? [] : [source.originalUrl]), ...source.alternateUrls]
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
      if (kind === 'html') {
        // 断りの画面も HTTP としては成功するので、種別まで見る。
        if (!(fetched.contentType ?? '').includes('html')) {
          await rm(fetched.path, { force: true })
          failures.push(`${url}: HTML ではない (content-type=${fetched.contentType})`)
          continue
        }
      }
      if (kind === 'pdf') {
        const head = await readFile(fetched.path, { encoding: null })
        if (!looksLikePdf(head.subarray(0, 8))) {
          // 断った中身を残すと、原本があるように見えてしまう。次の段階も再開の判定も
          // 成果物の存在を見ているためである(0004)。
          await rm(fetched.path, { force: true })
          failures.push(`${url}: PDF ではない (content-type=${fetched.contentType})`)
          continue
        }
      }
      return { url, path: fetched.path }
    } catch (error) {
      failures.push(`${url}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  throw new FetchAllFailed(failures)
}

/** すべての所在で取れなかったときの失敗。別の所在を探し直すために、内訳を持たせる。 */
export class FetchAllFailed extends Error {
  readonly failures: string[]

  constructor(failures: string[]) {
    super(
      `PDF の原本を取得できなかった。手元に PDF があれば、取り込みの欄から選んで入れられる(0021)。試した所在:\n${failures.join('\n')}`,
    )
    this.name = 'FetchAllFailed'
    this.failures = failures
  }
}

/**
 * 挙がった所在で取れなければ、別の所在を探してもう一度試す(#221)。
 *
 * 1 度目に挙がる所在は少なく、通信で落ちたり弾かれたりするとそこで終わってしまう。
 * 何が駄目だったかを渡して探し直すと、閲覧ページの奥にある PDF や別の置き場に届く。
 */
async function fetchWithRetry(
  slug: string,
  source: ResolvedSource,
  deps: IngestDeps,
): Promise<{ url: string; path: string }> {
  const tried = candidates(source)
  try {
    return await fetchFirst(deps.dataDir, slug, tried, 'pdf')
  } catch (error) {
    if (!(error instanceof FetchAllFailed)) throw error

    const more = await findMoreSources(
      { title: source.title, authors: source.authors, year: source.year },
      error.failures.join('\n'),
      { codex: deps.codex, model: deps.model },
    )
    const fresh = more.filter((url) => !tried.includes(url))
    if (fresh.length > 0) {
      try {
        return await fetchFirst(deps.dataDir, slug, fresh, 'pdf')
      } catch (second) {
        if (!(second instanceof FetchAllFailed)) throw second
        return await fetchHtml(slug, source, [...tried, ...fresh], [...error.failures, ...second.failures], deps)
      }
    }
    return await fetchHtml(slug, source, tried, error.failures, deps)
  }
}

/**
 * PDF が取れないときに、HTML の原本を取る(0022、0004)。
 *
 * 閲覧ページしか出さない出版社と、HTML でしか出ない論文がある。HTML の原本は照合を
 * 飛ばして本文だけを取り出す。
 */
async function fetchHtml(
  slug: string,
  source: ResolvedSource,
  tried: string[],
  failures: string[],
  deps: IngestDeps,
): Promise<{ url: string; path: string }> {
  try {
    return await fetchFirst(deps.dataDir, slug, tried, 'html')
  } catch (error) {
    if (!(error instanceof FetchAllFailed)) throw error
    throw new FetchAllFailed([...failures, ...error.failures.map((f) => `${f} (HTML としても取れない)`)])
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
      byTitle: (title) => findByTitle(deps.index, title),
    },
  })

  if (outcome.kind === 'duplicate') {
    const record = deps.ingests.get(outcome.slug)
    const state = record === null ? 'imported' : record.status === 'done' ? 'imported' : record.status
    return { ...outcome, state }
  }

  const { source } = outcome
  // URL か題名から解決したときは、必ず入り口の文字列が返る。
  const sourceUrl = outcome.sourceUrl ?? url
  const taken = new Set([...deps.index.allSlugs(), ...deps.ingests.takenSlugs()])
  const slug = buildSlug(
    {
      authors: source.authors,
      year: source.year,
      keyword: source.slugKeyword ?? source.title,
      identity: source.arxivId ?? source.originalUrl ?? sourceUrl,
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

    const taken = await fetchWithRetry(slug, source, deps)
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


/**
 * 題が同じ論文を引く。
 *
 * 突き合わせは、大文字と小文字、前後の空白、記号の違いを均してから行う。同じ論文でも
 * 出所によって記号の書き方が変わるためである。
 */
export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[\u2018\u2019\u201c\u201d]/g, "'")
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

function findByTitle(index: IndexDb, title: string): string | null {
  const wanted = normalizeTitle(title)
  if (wanted.length === 0) return null
  for (const paper of index.titles()) {
    if (normalizeTitle(paper.title) === wanted) return paper.slug
  }
  return null
}

/**
 * 手元から預かった原本を取り込む(0021)。
 *
 * 解決は原本の先頭から読み、取得は預かった原本をコレクションへ移す操作になる。取り込みが
 * 始まらなかったときは、預かった原本も置き場に残さない。
 */
export async function ingestFromUpload(staged: StagedOriginal, deps: UploadIngestDeps): Promise<IngestResult> {
  const outcome = await resolveFromOriginal(staged.path, {
    codex: deps.codex,
    model: deps.model,
    head: deps.head,
    known: {
      byArxivId: (id) => deps.index.findByArxivId(id) ?? deps.ingests.byArxivId(id)?.slug ?? null,
      bySourceUrl: (u) => deps.index.findBySourceUrl(u) ?? deps.ingests.bySourceUrl(u)?.slug ?? null,
      byTitle: (title) => findByTitle(deps.index, title),
    },
  })

  if (outcome.kind === 'duplicate') {
    const record = deps.ingests.get(outcome.slug)
    const state = record === null ? 'imported' : record.status === 'done' ? 'imported' : record.status
    return { ...outcome, state }
  }

  const { source } = outcome
  const taken = new Set([...deps.index.allSlugs(), ...deps.ingests.takenSlugs()])
  const slug = buildSlug(
    {
      authors: source.authors,
      year: source.year,
      keyword: source.slugKeyword ?? source.title,
      identity: staged.id,
    },
    (candidate) => taken.has(candidate),
  )

  // 記録には手元から入れたことと選んだファイルの名前を残す。識別子を含めるのは、同じ名前の
  // ファイルを別の論文で選んだときに、URL の突き合わせで同じものに見えないためである(0021)。
  deps.ingests.start({
    slug,
    sourceUrl: `upload:${staged.id}/${staged.name}`,
    arxivId: null,
    originalUrl: null,
  })
  deps.ingests.startStage(slug, 'resolve')

  try {
    await writePaper(deps.dataDir, toMeta(slug, source, null), '')
    if (source.abstract !== null && source.abstract.length > 0) {
      await writePaperSideFile(deps.dataDir, slug, 'abstract', source.abstract, 'en')
    }
    deps.ingests.advance(slug, 'fetch')

    await mkdir(paperDir(deps.dataDir, slug), { recursive: true })
    await moveFile(staged.path, paperOriginalPdf(deps.dataDir, slug))
    deps.ingests.advance(slug, 'convert')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    deps.ingests.fail(slug, message)
    throw error
  }

  return { kind: 'imported', slug, stagesRun: ['resolve', 'fetch'] }
}

/**
 * 置き場からコレクションへ移す。
 *
 * 置き場は状態のディレクトリ、コレクションは別の場所を指しうるので、同じファイルシステムで
 * ないことがある。名前の付け替えができないときは写して消す。
 */
async function moveFile(from: string, to: string): Promise<void> {
  try {
    await rename(from, to)
  } catch {
    await copyFile(from, to)
    await rm(from, { force: true })
  }
}

/**
 * 失敗した取り込みを、どこから動かし直すかを決める(#220)。
 *
 * 段階は成果物の存在から判定できる(0004)。原本を持たない取り込みは、所在を探すところから
 * やり直すしかないので、成果物を捨てて解決から積み直す。原本があるものは、済んだ段階を
 * 飛ばして続きから積む。
 */
export type ResumePlan =
  | { kind: 'restart'; target: string }
  | { kind: 'continue'; slug: string; stage: IngestStage }
  | { kind: 'unavailable'; reason: string }

export async function planResume(dataDir: string, record: IngestRecord): Promise<ResumePlan> {
  const done = await completedStages(dataDir, record.slug)

  if (!done.has('fetch')) {
    // 手元から入れた原本は置き場から消えているので、もう一度選んでもらうしかない。
    if (record.sourceUrl.startsWith('upload:')) {
      return { kind: 'unavailable', reason: '手元から入れた原本は残っていない。もう一度 PDF を選ぶこと' }
    }
    return { kind: 'restart', target: record.sourceUrl }
  }

  // 書誌は成果物を持たないので、翻訳が済んでいるかで済んだかを判じる。どちらも同じ場所へ
  // 上書きするだけなので、もう一度走っても副作用が無い。
  const stage: IngestStage = !done.has('convert')
    ? 'convert'
    : !done.has('verify')
      ? 'verify'
      : !done.has('translate')
        ? 'bibliography'
        : !done.has('references')
          ? 'references'
          : 'register'
  return { kind: 'continue', slug: record.slug, stage }
}

/** 取り込みを取り消す。成果物と記録の両方を消す。 */
export async function discardIngest(dataDir: string, slug: string, ingests: IngestStore): Promise<void> {
  await deletePaperDir(dataDir, slug)
  ingests.remove(slug)
}
