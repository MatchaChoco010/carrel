import type { CodexClient } from '../codex/client.ts'
import { imagesAndTextInput, textInput } from '../codex/protocol.ts'
import { normalizeDoi } from '../data/doi.ts'
import { runTurn, startWorkThread } from '../codex/threads.ts'
import { extractArxivId, isArxivUrl, lookupArxiv } from './arxiv.ts'
import { readOriginalHead, type HeadPaths } from './head.ts'
import { readPageHint, type PageHint } from './links.ts'
import type { ResolvedSource, ResolveOutcome, SourceKind } from './types.ts'

/** 既に取り込んである論文を引く口。 */
export type KnownPapers = {
  byArxivId: (arxivId: string) => string | null
  bySourceUrl: (url: string) => string | null
  /** 題での突き合わせ。手元から入れた原本には URL が無いので、これで重複を判じる(0021)。 */
  byTitle: (title: string) => string | null
}

/**
 * 指されたページから読み取れたものを、問い合わせに添える(#243)。
 *
 * URL の文字だけで探すと、題の似た別の論文に行き着くことがある。ページの標題と、
 * そこに置かれている PDF を先に見せる。
 */
function describeHint(hint: PageHint | null): string[] {
  if (hint === null) return []
  const lines = ['', 'そのページから読み取れたもの(こちらを優先して信じること):']
  if (hint.title !== null) lines.push(`ページの標題: ${hint.title}`)
  if (hint.pdfLinks.length > 0) {
    lines.push('そのページに置かれている PDF:')
    for (const link of hint.pdfLinks) lines.push(`- ${link}`)
    lines.push('この PDF が論文の本体なら、originalUrl にそれを入れる。')
  }
  return lines
}

const AGENT_INSTRUCTIONS = [
  'あなたは論文の所在と書誌情報を調べる。',
  'web 検索と取得を使って、指された論文の原本(PDF、無ければ HTML)を見つける。',
  '取りに行くのはブラウザではなく素の HTTP の道具である。',
  'そのため arXiv・著者のページ・研究機関のリポジトリのように、そのまま PDF が返る所在を優先する。',
  '論文ごとのプロジェクトページ(多くは GitHub Pages の `*.github.io`)は、著者が PDF を置いている場所として最も当たりが良い。題名で探し、見つけたらページを開いて PDF への直リンクを取る。',
  '題名が長いときは、そのまま検索の語にしない。特徴的な語を 4〜6 語に絞って探す。長い題名のままだと出版社のページしか出てこない。',
  '出版社のページしか出てこないときは、題名に `project page`・`code`・`supplemental`・著者名を足して探し直す。',
  '出版社の閲覧ページ(dl.acm.org、diglib.eg.org、onlinelibrary.wiley.com など)は、会話状態や合意の操作を要求して PDF を返さないことが多い。',
  'researchgate.net と academia.edu も素の HTTP を弾く。他に何も無いときの最後の候補にとどめる。',
  '出版社の閲覧ページを見つけたら、そのページを開いて PDF への直リンクを探す。閲覧ページと PDF で URL の形が違う出版社が多い。',
  '取れそうな所在は alternateUrls にできるだけ並べる。1 つ目が取れなかったときに順に試すので、多いほど取り込みが通りやすい。',
  'どこにも取得できる原本が無いときは originalUrl を null にして返す。当てずっぽうの URL を書かない。',
  '要求された JSON だけを返す。',
].join('\n')

const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    originalUrl: { type: ['string', 'null'], description: '取得できる原本の URL。見つからなければ null。' },
    alternateUrls: {
      type: 'array',
      items: { type: 'string' },
      description: '同じ論文が取れる別の所在。無ければ空の配列。',
    },
    kind: { type: 'string', enum: ['pdf', 'html'] },
    title: { type: 'string' },
    authors: { type: 'array', items: { type: 'string' } },
    year: { type: ['integer', 'null'] },
    venue: { type: ['string', 'null'] },
    abstract: { type: ['string', 'null'] },
    arxivId: { type: ['string', 'null'] },
    doi: { type: ['string', 'null'], description: '出版元の DOI。10. で始まる形。無ければ null。' },
    slugKeyword: {
      type: ['string', 'null'],
      description:
        '論文自身が題の中で与えている略称(コロンの前など)。題に出てこない語を作らない。無ければ null。',
    },
  },
  required: [
    'originalUrl',
    'alternateUrls',
    'kind',
    'title',
    'authors',
    'year',
    'venue',
    'abstract',
    'arxivId',
    'doi',
    'slugKeyword',
  ],
  additionalProperties: false,
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function parseAgentResult(text: string): ResolvedSource | null {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return null
  }
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>

  const originalUrl = asString(r['originalUrl'])
  const title = asString(r['title'])
  if (originalUrl === null || title === null) return null

  const kind: SourceKind = r['kind'] === 'html' ? 'html' : 'pdf'
  const year = typeof r['year'] === 'number' && Number.isInteger(r['year']) ? r['year'] : null

  const alternateUrls = Array.isArray(r['alternateUrls'])
    ? r['alternateUrls'].filter((u): u is string => typeof u === 'string' && /^https?:\/\//i.test(u.trim())).map((u) => u.trim())
    : []

  return {
    originalUrl,
    alternateUrls,
    kind,
    title,
    authors: Array.isArray(r['authors'])
      ? r['authors'].filter((a): a is string => typeof a === 'string' && a.trim().length > 0).map((a) => a.trim())
      : [],
    year,
    venue: asString(r['venue']),
    abstract: asString(r['abstract']),
    arxivId: asString(r['arxivId']),
    doi: normalizeDoi(asString(r['doi'])),
    slugKeyword: asString(r['slugKeyword']),
    via: 'agent',
  }
}

export type ResolveDeps = {
  known: KnownPapers
  codex: CodexClient
  model: string
}

/** 入力が URL かどうか。URL でなければ題名として扱う。 */
export function looksLikeUrl(input: string): boolean {
  return /^https?:\/\//i.test(input.trim())
}

/**
 * URL か題名から、原本の所在と書誌情報を確定する。
 *
 * 題名で指された場合は web 検索で探す。出版社の版が有料のときは著者版を探させ、
 * どこにも取得できる原本が無ければ失敗にする。
 */
export async function resolveSource(sourceUrl: string, deps: ResolveDeps): Promise<ResolveOutcome> {
  const bySourceUrl = deps.known.bySourceUrl(sourceUrl)
  if (bySourceUrl !== null) return { kind: 'duplicate', slug: bySourceUrl, reason: 'sourceUrl' }

  if (looksLikeUrl(sourceUrl) && isArxivUrl(sourceUrl)) {
    const arxivId = extractArxivId(sourceUrl)
    if (arxivId !== null) {
      const byId = deps.known.byArxivId(arxivId)
      if (byId !== null) return { kind: 'duplicate', slug: byId, reason: 'arxivId' }

      const source = await lookupArxiv(arxivId)
      if (source !== null) return { kind: 'resolved', source, sourceUrl }
    }
  }

  const threadId = await startWorkThread(deps.codex, {
    instructions: AGENT_INSTRUCTIONS,
    model: deps.model,
    webSearch: true,
  })
  const asked = looksLikeUrl(sourceUrl)
    ? [
        `次の URL が指す論文の原本と書誌情報を調べよ: ${sourceUrl}`,
        ...describeHint(await readPageHint(sourceUrl)),
      ].join('\n')
    : `次の題名の論文を探し、取得できる原本と書誌情報を返せ: ${sourceUrl}`
  const outcome = await runTurn(deps.codex, {
    threadId,
    input: textInput(asked),
    effort: 'low',
    outputSchema: OUTPUT_SCHEMA,
  })

  const source = parseAgentResult(outcome.text)
  if (source === null) {
    throw new Error(
      looksLikeUrl(sourceUrl)
        ? `URL を解決できなかった: ${sourceUrl}`
        : `取得できる原本が見つからなかった: ${sourceUrl}`,
    )
  }

  // エージェントが arXiv の識別子を見つけた場合も、重複の判定に使う。
  if (source.arxivId !== null) {
    const byId = deps.known.byArxivId(source.arxivId)
    if (byId !== null) return { kind: 'duplicate', slug: byId, reason: 'arxivId' }
  }

  return { kind: 'resolved', source, sourceUrl }
}

/**
 * 手元の原本の先頭から書誌を読み取る指示。
 *
 * web は探させない。学会名と DOI を確かめるのは後の段階の仕事である(0020)。ここで要るのは
 * slug を決めるための名前と、重複を判じるための題名だけである(0021)。
 */
const HEAD_INSTRUCTIONS = [
  'あなたは論文の原本の先頭から書誌情報を読み取る。',
  '渡されるのは PDF の先頭 2 ページ分である。文字層か、そのページの画像で届く。',
  '所属機関のリポジトリが付けた表紙が先頭にあることがある。表紙ではなく論文そのものの標題を選ぶ。',
  '著者は紙面の書式をそのまま写さない。全部を大文字にした表記は、通常の表記に直す。',
  '読み取れない項目は null にする。web は使わない。',
  '要求された JSON だけを返す。',
].join('\n')

const HEAD_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: ['string', 'null'], description: '論文の標題。' },
    authors: { type: 'array', items: { type: 'string' }, description: '著者。順序を保つ。' },
    year: { type: ['integer', 'null'], description: '紙面から読める出版年。無ければ null。' },
    abstract: { type: ['string', 'null'], description: 'abstract の本文。無ければ null。' },
    slugKeyword: {
      type: ['string', 'null'],
      description:
        '論文自身が題の中で与えている略称(コロンの前など)。題に出てこない語を作らない。無ければ null。',
    },
  },
  required: ['title', 'authors', 'year', 'abstract', 'slugKeyword'],
  additionalProperties: false,
}

export type ResolveOriginalDeps = ResolveDeps & {
  /** 原本の先頭を読む道具。 */
  head: HeadPaths
}

/**
 * 手元の原本から書誌を確定する(0021)。
 *
 * 原本は既に手元にあるので、所在は空にする。`source_url` と `pdf_url` を持たない論文に
 * なり、出所は後の段階が入れる DOI が表す(0020)。
 */
export async function resolveFromOriginal(pdf: string, deps: ResolveOriginalDeps): Promise<ResolveOutcome> {
  const head = await readOriginalHead(pdf, deps.head)
  const threadId = await startWorkThread(deps.codex, { instructions: HEAD_INSTRUCTIONS, model: deps.model })
  try {
    const asked = '次の原本の先頭から、論文の書誌情報を読み取れ。'
    const outcome = await runTurn(deps.codex, {
      threadId,
      input:
        head.kind === 'text'
          ? textInput(`${asked}\n\n${head.text.slice(0, HEAD_CHARS)}`)
          : imagesAndTextInput(head.files, asked),
      effort: 'low',
      outputSchema: HEAD_SCHEMA,
    })

    const source = parseHeadResult(outcome.text)
    if (source === null) throw new Error('原本の先頭から書誌を読み取れなかった')

    const byTitle = deps.known.byTitle(source.title)
    if (byTitle !== null) return { kind: 'duplicate', slug: byTitle, reason: 'title' }

    return { kind: 'resolved', source, sourceUrl: null }
  } finally {
    if (head.kind === 'images') await head.dispose()
  }
}

/** 文字層を渡すときの上限。標題と著者と abstract が収まればよい。 */
const HEAD_CHARS = 12000

function parseHeadResult(text: string): ResolvedSource | null {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return null
  }
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>

  const title = asString(r['title'])
  if (title === null) return null

  return {
    originalUrl: null,
    alternateUrls: [],
    kind: 'pdf',
    title,
    authors: Array.isArray(r['authors'])
      ? r['authors'].filter((a): a is string => typeof a === 'string' && a.trim().length > 0).map((a) => a.trim())
      : [],
    year: typeof r['year'] === 'number' && Number.isInteger(r['year']) ? r['year'] : null,
    venue: null,
    abstract: asString(r['abstract']),
    arxivId: null,
    doi: null,
    slugKeyword: asString(r['slugKeyword']),
    via: 'original',
  }
}

/**
 * 挙がった所在がすべて取れなかったときに、別の所在を探す(#221)。
 *
 * 1 度目の探索で挙がる所在は少なく、通信で落ちたり弾かれたりするとそこで終わってしまう。
 * 何が駄目だったかを伝えて、別の所在を挙げさせる。
 */
const MORE_INSTRUCTIONS = [
  'あなたは論文の原本の所在を探す。',
  '既に試した所在と、その失敗の理由を渡す。同じ所在を挙げない。',
  '取りに行くのはブラウザではなく素の HTTP の道具である。そのまま PDF が返る所在を挙げる。',
  'researchgate.net と academia.edu も素の HTTP を弾く。他に何も無いときの最後の候補にとどめる。',
  '出版社の閲覧ページを見つけたら、そのページを開いて PDF への直リンクを探す。閲覧ページと PDF で URL の形が違う出版社が多い。',
  '論文ごとのプロジェクトページ(多くは GitHub Pages の `*.github.io`)を最初に当たる。著者が PDF を置いている場所として最も当たりが良い。',
  '題名が長いときは、そのまま検索の語にしない。特徴的な語を 4〜6 語に絞って探す。長い題名のままだと出版社のページしか出てこない。',
  '題名だけで出てこないときは、題名に `project page`・`code`・`supplemental`・著者名を足して探し直す。',
  '著者のページ、研究室のページ、所属機関のリポジトリ、arXiv も当たる。',
  '取れる見込みのある所在が無ければ空の配列を返す。当てずっぽうの URL を書かない。',
  '要求された JSON だけを返す。',
].join('\n')

const MORE_SCHEMA = {
  type: 'object',
  properties: {
    urls: { type: 'array', items: { type: 'string' }, description: 'まだ試していない所在。無ければ空。' },
  },
  required: ['urls'],
  additionalProperties: false,
}

export type MoreSourcesDeps = {
  codex: CodexClient
  model: string
}

/** 別の所在を探す。挙がらなければ空を返す。 */
export async function findMoreSources(
  source: { title: string; authors: string[]; year: number | null },
  failures: string,
  deps: MoreSourcesDeps,
): Promise<string[]> {
  const threadId = await startWorkThread(deps.codex, {
    instructions: MORE_INSTRUCTIONS,
    model: deps.model,
    webSearch: true,
  })
  const asked = [
    `題名: ${source.title}`,
    source.authors.length > 0 ? `著者: ${source.authors.join(', ')}` : null,
    source.year === null ? null : `出版年: ${source.year}`,
    '',
    '試した所在と失敗の理由:',
    failures,
  ]
    .filter((line): line is string => line !== null)
    .join('\n')

  const outcome = await runTurn(deps.codex, {
    threadId,
    input: textInput(asked),
    effort: 'low',
    outputSchema: MORE_SCHEMA,
  })

  let raw: unknown
  try {
    raw = JSON.parse(outcome.text)
  } catch {
    return []
  }
  const urls = (raw as Record<string, unknown>)['urls']
  if (!Array.isArray(urls)) return []
  return urls.filter((u): u is string => typeof u === 'string' && /^https?:\/\//i.test(u.trim())).map((u) => u.trim())
}

/**
 * PDF がどこからも取れないときに、本文が載っている HTML のページを探す(#243)。
 *
 * 原本は PDF が本命で、HTML は最後の受け皿である(0022)。取れなかった PDF の所在を
 * そのまま HTML として取ると、出版社の判定ページや案内のページを原本にしてしまう。
 * 本文が載っているページかどうかを、探す側に確かめさせる。
 */
const ARTICLE_INSTRUCTIONS = [
  'あなたは論文の本文が読める HTML のページを探す。',
  '既に試した所在と、その失敗の理由を渡す。同じ所在を挙げない。',
  '挙げてよいのは、本文の節がそのページの HTML に入っているものだけである。',
  '次のページは挙げない。',
  '- 概要と書誌だけの閲覧ページ(本文が読めないもの)。',
  '- 本文を JavaScript で描くページ(取得した HTML に本文が入らない)。',
  '- 会話状態や合意の操作を求めるページ(dl.acm.org など)。',
  'arXiv の HTML 版、著者や研究室が置いた本文のページ、出版社の全文ページは当たる。',
  '見つからなければ空の配列を返す。当てずっぽうの URL を書かない。',
  '要求された JSON だけを返す。',
].join('\n')

/** 本文が読める HTML のページを探す。無ければ空を返す。 */
export async function findArticlePages(
  source: { title: string; authors: string[]; year: number | null },
  failures: string,
  deps: MoreSourcesDeps,
): Promise<string[]> {
  const threadId = await startWorkThread(deps.codex, {
    instructions: ARTICLE_INSTRUCTIONS,
    model: deps.model,
    webSearch: true,
  })
  const asked = [
    `題名: ${source.title}`,
    source.authors.length > 0 ? `著者: ${source.authors.join(', ')}` : null,
    source.year === null ? null : `出版年: ${source.year}`,
    '',
    'PDF を試した所在と失敗の理由:',
    failures,
  ]
    .filter((line): line is string => line !== null)
    .join('\n')

  const outcome = await runTurn(deps.codex, {
    threadId,
    input: textInput(asked),
    effort: 'low',
    outputSchema: MORE_SCHEMA,
  })

  let raw: unknown
  try {
    raw = JSON.parse(outcome.text)
  } catch {
    return []
  }
  const urls = (raw as Record<string, unknown>)['urls']
  if (!Array.isArray(urls)) return []
  return urls.filter((u): u is string => typeof u === 'string' && /^https?:\/\//i.test(u.trim())).map((u) => u.trim())
}
