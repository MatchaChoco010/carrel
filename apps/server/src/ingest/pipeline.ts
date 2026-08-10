import { access, copyFile, mkdir, readFile, rename, rm } from 'node:fs/promises'
import type { CodexClient } from '../codex/client.ts'
import { nowIsoDateTime } from '../data/datetime.ts'
import { paperDir, paperFile, paperOriginalHtml, paperOriginalPdf } from '../data/layout.ts'
import { deletePaperDir, readPaper, writePaper, writePaperSideFile, type PaperMeta } from '../data/paper.ts'
import { buildSlug } from '../data/slug.ts'
import type { IndexDb } from '../db/index-db.ts'
import { fetchOriginal, looksLikePdf } from './fetch.ts'
import { countPages, readOriginalHead, type HeadPaths, type OriginalHead } from './head.ts'
import { judgeOriginal, type AskedPaper } from './judge.ts'
import { scanForPdfLinks } from './links.ts'
import { findSamePaper, type Candidate } from './same-paper.ts'
import { findArticlePages, findMoreSources, looksLikeUrl, resolveFromOriginal, resolveSource } from './resolve.ts'
import type { StagedOriginal } from './staging.ts'
import type { IngestRecord, IngestStore } from './store.ts'
import type { IngestStage, ResolvedSource } from './types.ts'

export type IngestDeps = {
  dataDir: string
  index: IndexDb
  ingests: IngestStore
  codex: CodexClient
  model: string
  /** 原本の先頭を読む道具(0021、0025)。 */
  head: HeadPaths
  /**
   * この取り込みを受け付けた時刻(解決の仕事が積まれた時刻)。
   *
   * 記録ができるのは解決が終わってからなので、その時点では受け付けた時刻が分からない。
   * 呼ぶ側から持ち回る(#311)。
   */
  acceptedAt: number
}

export type IngestResult =
  | { kind: 'imported'; slug: string; stagesRun: IngestStage[] }
  | {
      kind: 'duplicate'
      slug: string
      reason: 'arxivId' | 'sourceUrl' | 'bibliography'
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

/**
 * 同じ論文かを突き合わせる相手(#263)。
 *
 * 索引に載っている論文だけでなく、まだ登録まで進んでいない取り込みも入れる。索引だけを
 * 見ると、途中で失敗した取り込みと同じ論文をもう一度入れたときに連番が付く。
 */
function samePaperCandidates(deps: IngestDeps): Candidate[] {
  return [...deps.index.identities(), ...deps.ingests.pendingIdentities()]
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
/** 取れた中身を原本として受け取ってよいかを判じる(0025)。 */
type Accept = (path: string) => Promise<{ ok: true } | { ok: false; reason: string }>

async function fetchFirst(
  dataDir: string,
  slug: string,
  urls: string[],
  kind: ResolvedSource['kind'],
  accept: Accept,
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
      // 種別が合っていても、頼んだ論文とは限らない(0025)。
      const judged = await accept(fetched.path)
      if (!judged.ok) {
        await rm(fetched.path, { force: true })
        failures.push(`${url}: ${judged.reason}`)
        continue
      }
      return { url, path: fetched.path }
    } catch (error) {
      failures.push(`${url}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  throw new FetchAllFailed(failures)
}

/**
 * 取れた原本が頼んだ論文かを確かめる受け入れ(0025)。
 *
 * 判定そのものが行えなかったときも、その候補を落とす。確かめずに受け取ると、この判定が
 * 防ごうとしているものが素通りするためである。仕事は積み直せる。
 */
function acceptIfAsked(asked: AskedPaper, kind: ResolvedSource['kind'], deps: IngestDeps): Accept {
  return async (path) => {
    const head = kind === 'html' ? await readHtmlHead(path) : await readOriginalHead(path, deps.head)
    try {
      const judged = await judgeOriginal(head, asked, { codex: deps.codex, model: deps.model })
      return judged.same ? { ok: true } : { ok: false, reason: judged.reason }
    } catch (error) {
      return { ok: false, reason: `頼んだ論文かを判じられなかった: ${error instanceof Error ? error.message : String(error)}` }
    } finally {
      if (head.kind === 'images') await head.dispose()
    }
  }
}

/**
 * HTML の原本の先頭を、判定に渡せる形で読む(0025)。
 *
 * 本文の塊を選ぶ前(0022)でも、題と著者は文字として出ている。印は落として文字だけにする。
 */
async function readHtmlHead(path: string): Promise<OriginalHead> {
  const html = await readFile(path, 'utf8')
  const text = html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;|&#\d+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return { kind: 'text', text }
}

/**
 * 取ってきた原本のページ数を記録に入れる(#328)。
 *
 * 数えられなくても取り込みは続ける。ページ数は原本の長さを人に見せるためのもので、
 * 取り込みの成否を決めるものではない。
 */
async function recordPages(slug: string, pdf: string, deps: IngestDeps): Promise<void> {
  try {
    deps.ingests.setPages(slug, await countPages(pdf, deps.head))
  } catch {
    // 読めない原本でも、変換の段階が同じものを読んで改めて失敗する。
  }
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
 * 原本を取る。PDF を先に探し尽くし、それでも無いときだけ HTML にする(#243、0022)。
 *
 * 1. 解決が挙げた所在を PDF として試す。
 * 2. 取れなければ、失敗の理由を渡して別の PDF の所在を探す。
 * 3. 挙がったページの中に PDF への直リンクがあれば、それを試す。
 * 4. それでも無ければ、本文が載っている HTML のページを探して原本にする。
 *
 * 取れなかった PDF の所在をそのまま HTML として取らないのは、出版社の判定ページや
 * 案内のページを原本にしてしまうためである。
 */
async function fetchWithRetry(
  slug: string,
  source: ResolvedSource,
  deps: IngestDeps,
  entry: string | null = null,
): Promise<{ url: string; path: string }> {
  // 渡された URL は必ず試す。解決が出版社のページに置き換えてしまうことがあり、
  // そのままだと指されたページを一度も見ないまま失敗する(#243)。
  const tried = [...new Set([...candidates(source), ...(entry === null ? [] : [entry])])]
  const asked: AskedPaper = { title: source.title, authors: source.authors, year: source.year }
  const failures: string[] = []
  const accept = acceptIfAsked(asked, source.kind, deps)

  try {
    return await fetchFirst(deps.dataDir, slug, tried, 'pdf', accept)
  } catch (error) {
    if (!(error instanceof FetchAllFailed)) throw error
    failures.push(...error.failures)
  }

  const more = (await findMoreSources(asked, failures.join('\n'), { codex: deps.codex, model: deps.model })).filter(
    (url) => !tried.includes(url),
  )
  if (more.length > 0) {
    try {
      return await fetchFirst(deps.dataDir, slug, more, 'pdf', accept)
    } catch (error) {
      if (!(error instanceof FetchAllFailed)) throw error
      failures.push(...error.failures)
      tried.push(...more)
    }
  }

  const linked = (await scanForPdfLinks(tried)).filter((url) => !tried.includes(url))
  if (linked.length > 0) {
    try {
      return await fetchFirst(deps.dataDir, slug, linked, 'pdf', accept)
    } catch (error) {
      if (!(error instanceof FetchAllFailed)) throw error
      failures.push(...error.failures)
      tried.push(...linked)
    }
  }

  const articles = (
    await findArticlePages(asked, failures.join('\n'), { codex: deps.codex, model: deps.model })
  ).filter((url) => !tried.includes(url))
  if (articles.length === 0) throw new FetchAllFailed(failures)

  try {
    return await fetchFirst(deps.dataDir, slug, articles, 'html', acceptIfAsked(asked, 'html', deps))
  } catch (error) {
    if (!(error instanceof FetchAllFailed)) throw error
    throw new FetchAllFailed([...failures, ...error.failures.map((f) => `${f} (本文のページとしても取れない)`)])
  }
}

/** 解決と取得までを行う。 */
export async function ingestFromUrl(url: string, deps: IngestDeps): Promise<IngestResult> {
  // 解決は web を探すので数十秒かかる。記録ができるのはその後なので、走り出した時刻を
  // ここで取っておき、解決の段階が動き始めた時刻として刻む(#238、#311)。
  const ranAt = Date.now()
  const outcome = await resolveSource(url, {
    codex: deps.codex,
    model: deps.model,
    known: {
      byArxivId: (id) => deps.index.findByArxivId(id) ?? deps.ingests.byArxivId(id)?.slug ?? null,
      bySourceUrl: (u) => deps.index.findBySourceUrl(u) ?? deps.ingests.bySourceUrl(u)?.slug ?? null,
      samePaper: (identity) => findSamePaper(samePaperCandidates(deps), identity),
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
      title: source.title,
      keepWords: source.slugKeepWords,
      identity: source.arxivId ?? source.originalUrl ?? sourceUrl,
    },
    (candidate) => taken.has(candidate),
  )

  deps.ingests.start(
    {
      slug,
      sourceUrl,
      arxivId: source.arxivId,
      originalUrl: source.originalUrl,
      title: source.title,
      doi: source.doi,
    },
    deps.acceptedAt,
  )
  deps.ingests.queueStage(slug, 'resolve', deps.acceptedAt)
  deps.ingests.beginStage(slug, 'resolve', ranAt)

  try {
    // abstract を paper.md へ書かないのは、本文を照合が確定させるためである。
    // ここへ書くと後で失われる。
    await writePaper(deps.dataDir, toMeta(slug, source, sourceUrl), '')
    if (source.abstract !== null && source.abstract.length > 0) {
      await writePaperSideFile(deps.dataDir, slug, 'abstract', source.abstract, 'en')
    }
    deps.ingests.advanceRunning(slug, 'fetch')

    const taken = await fetchWithRetry(slug, source, deps, looksLikeUrl(sourceUrl) ? sourceUrl : null)
    // 別の所在から取れたときは、原本の場所をそこへ直す。
    if (taken.url !== source.originalUrl) {
      await writePaper(deps.dataDir, { ...toMeta(slug, source, sourceUrl), pdfUrl: taken.url }, '')
    }
    if (source.kind !== 'html') await recordPages(slug, taken.path, deps)
    deps.ingests.advance(slug, 'convert')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    deps.ingests.fail(slug, message)
    throw error
  }

  return { kind: 'imported', slug, stagesRun: ['resolve', 'fetch'] }
}


/**
 * 手元から預かった原本を取り込む(0021)。
 *
 * 解決は原本の先頭から読み、取得は預かった原本をコレクションへ移す操作になる。取り込みが
 * 始まらなかったときは、預かった原本も置き場に残さない。
 */
export async function ingestFromUpload(staged: StagedOriginal, deps: IngestDeps): Promise<IngestResult> {
  // 原本の先頭を読むのに時間がかかる。記録ができるのはその後なので、走り出した時刻を
  // ここで取っておく(#311)。
  const ranAt = Date.now()
  const outcome = await resolveFromOriginal(staged.path, {
    codex: deps.codex,
    model: deps.model,
    head: deps.head,
    known: {
      byArxivId: (id) => deps.index.findByArxivId(id) ?? deps.ingests.byArxivId(id)?.slug ?? null,
      bySourceUrl: (u) => deps.index.findBySourceUrl(u) ?? deps.ingests.bySourceUrl(u)?.slug ?? null,
      samePaper: (identity) => findSamePaper(samePaperCandidates(deps), identity),
    },
  })

  if (outcome.kind === 'duplicate') {
    const record = deps.ingests.get(outcome.slug)
    // 失敗した取り込みと同じ論文なら、選ばれた原本を入れ替えてそこから続ける(#263)。
    // 別の slug を立てると、題も DOI も同じ論文が 2 つ並ぶ。
    if (record !== null && record.status === 'failed') {
      await takeOverFailed(record.slug, staged, deps, ranAt)
      return { kind: 'imported', slug: record.slug, stagesRun: ['resolve', 'fetch'] }
    }
    const state = record === null ? 'imported' : record.status === 'done' ? 'imported' : record.status
    return { ...outcome, state }
  }

  const { source } = outcome
  const taken = new Set([...deps.index.allSlugs(), ...deps.ingests.takenSlugs()])
  const slug = buildSlug(
    {
      authors: source.authors,
      year: source.year,
      title: source.title,
      keepWords: source.slugKeepWords,
      identity: staged.id,
    },
    (candidate) => taken.has(candidate),
  )

  // 記録には手元から入れたことと選んだファイルの名前を残す。識別子を含めるのは、同じ名前の
  // ファイルを別の論文で選んだときに、URL の突き合わせで同じものに見えないためである(0021)。
  deps.ingests.start(
    {
      slug,
      sourceUrl: `upload:${staged.id}/${staged.name}`,
      arxivId: null,
      originalUrl: null,
      title: source.title,
      doi: source.doi,
    },
    deps.acceptedAt,
  )
  deps.ingests.queueStage(slug, 'resolve', deps.acceptedAt)
  deps.ingests.beginStage(slug, 'resolve', ranAt)

  try {
    await writePaper(deps.dataDir, toMeta(slug, source, null), '')
    if (source.abstract !== null && source.abstract.length > 0) {
      await writePaperSideFile(deps.dataDir, slug, 'abstract', source.abstract, 'en')
    }
    deps.ingests.advanceRunning(slug, 'fetch')

    await mkdir(paperDir(deps.dataDir, slug), { recursive: true })
    await moveFile(staged.path, paperOriginalPdf(deps.dataDir, slug))
    await recordPages(slug, paperOriginalPdf(deps.dataDir, slug), deps)
    deps.ingests.advance(slug, 'convert')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    deps.ingests.fail(slug, message)
    throw error
  }

  return { kind: 'imported', slug, stagesRun: ['resolve', 'fetch'] }
}

/**
 * 失敗した取り込みの原本を、手元から選ばれた PDF に入れ替える(#263)。
 *
 * 書誌は前の解決が書いたものを残す。出版社のページから読み取った DOI や学会名を持って
 * おり、原本の先頭から読み取ったものより揃っているためである。
 *
 * 前の取得が HTML を置いていたら消す。両方あると、変換がどちらを読むかで結果が変わる。
 */
async function takeOverFailed(
  slug: string,
  staged: StagedOriginal,
  deps: IngestDeps,
  ranAt: number,
): Promise<void> {
  const record = deps.ingests.get(slug)
  deps.ingests.start(
    {
      slug,
      sourceUrl: `upload:${staged.id}/${staged.name}`,
      arxivId: record?.arxivId ?? null,
      originalUrl: null,
      title: record?.title ?? null,
      doi: record?.doi ?? null,
    },
    deps.acceptedAt,
  )
  deps.ingests.queueStage(slug, 'resolve', deps.acceptedAt)
  deps.ingests.beginStage(slug, 'resolve', ranAt)
  deps.ingests.advanceRunning(slug, 'fetch')

  await mkdir(paperDir(deps.dataDir, slug), { recursive: true })
  await rm(paperOriginalHtml(deps.dataDir, slug), { force: true })
  await moveFile(staged.path, paperOriginalPdf(deps.dataDir, slug))
  deps.ingests.advance(slug, 'convert')
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

/**
 * 題を持たない取り込みの記録に、その論文の `paper.md` から題と DOI を入れる(#271)。
 *
 * 題と DOI の欄は後から足したので、それ以前に失敗した記録は空のままである。空のままだと
 * 同じ論文かの突き合わせ(#263)の相手に入らず、手元の PDF を入れても連番が付く。
 * 書誌の正は論文のディレクトリ(0002)なので、そこから埋め直せる。
 *
 * 解決の段階で失敗した取り込みは `paper.md` を持たないが、その場合は slug も決まって
 * いないので突き合わせる必要が無い。
 */
export async function backfillIngestMetadata(dataDir: string, ingests: IngestStore): Promise<number> {
  let filled = 0
  for (const slug of ingests.missingMetadata()) {
    const paper = await readPaper(dataDir, slug)
    if (paper === null || paper.meta.title.length === 0) continue
    ingests.setMetadata(slug, paper.meta.title, paper.meta.doi)
    filled += 1
  }
  return filled
}

/** 取り込みを取り消す。成果物と記録の両方を消す。 */
export async function discardIngest(dataDir: string, slug: string, ingests: IngestStore): Promise<void> {
  await deletePaperDir(dataDir, slug)
  ingests.remove(slug)
}
