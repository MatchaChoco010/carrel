import type { CodexClient } from '../codex/client.ts'
import { textInput } from '../codex/protocol.ts'
import { normalizeDoi } from '../data/doi.ts'
import { runTurn, startWorkThread } from '../codex/threads.ts'
import { extractArxivId, isArxivUrl, lookupArxiv } from './arxiv.ts'
import type { ResolvedSource, ResolveOutcome, SourceKind } from './types.ts'

/** 既に取り込んである論文を引く口。 */
export type KnownPapers = {
  byArxivId: (arxivId: string) => string | null
  bySourceUrl: (url: string) => string | null
}

const AGENT_INSTRUCTIONS = [
  'あなたは論文の所在と書誌情報を調べる。',
  'web 検索と取得を使って、指された論文の原本(PDF、無ければ HTML)を見つける。',
  '取りに行くのはブラウザではなく素の HTTP の道具である。',
  'そのため arXiv・著者のページ・研究機関のリポジトリのように、そのまま PDF が返る所在を優先する。',
  '出版社の閲覧ページ(dl.acm.org、diglib.eg.org、onlinelibrary.wiley.com など)は、会話状態や合意の操作を要求して PDF を返さないことが多い。',
  '他に取れそうな所在があれば alternateUrls に並べる。1 つ目が取れなかったときに順に試す。',
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
      description: '論文に定着した略称。無ければタイトルの内容語を 1〜3 語。',
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
    ? `次の URL が指す論文の原本と書誌情報を調べよ: ${sourceUrl}`
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
