import type { CodexClient } from '../codex/client.ts'
import { textInput } from '../codex/protocol.ts'
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
  'web 検索と取得を使って、渡された URL が指す論文の原本(PDF、無ければ HTML)を見つける。',
  'ページ内に原本へのリンクが無い場合は、タイトルで検索して探す。',
  '要求された JSON だけを返す。',
].join('\n')

const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    originalUrl: { type: 'string' },
    kind: { type: 'string', enum: ['pdf', 'html'] },
    title: { type: 'string' },
    authors: { type: 'array', items: { type: 'string' } },
    year: { type: ['integer', 'null'] },
    venue: { type: ['string', 'null'] },
    abstract: { type: ['string', 'null'] },
    arxivId: { type: ['string', 'null'] },
    slugKeyword: {
      type: ['string', 'null'],
      description: '論文に定着した略称。無ければタイトルの内容語を 1〜3 語。',
    },
  },
  required: ['originalUrl', 'kind', 'title', 'authors', 'year', 'venue', 'abstract', 'arxivId', 'slugKeyword'],
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

  return {
    originalUrl,
    kind,
    title,
    authors: Array.isArray(r['authors'])
      ? r['authors'].filter((a): a is string => typeof a === 'string' && a.trim().length > 0).map((a) => a.trim())
      : [],
    year,
    venue: asString(r['venue']),
    abstract: asString(r['abstract']),
    arxivId: asString(r['arxivId']),
    slugKeyword: asString(r['slugKeyword']),
    via: 'agent',
  }
}

export type ResolveDeps = {
  known: KnownPapers
  codex: CodexClient
  model: string
}

/** URL から原本の所在と書誌情報を確定する。 */
export async function resolveSource(sourceUrl: string, deps: ResolveDeps): Promise<ResolveOutcome> {
  const bySourceUrl = deps.known.bySourceUrl(sourceUrl)
  if (bySourceUrl !== null) return { kind: 'duplicate', slug: bySourceUrl, reason: 'sourceUrl' }

  if (isArxivUrl(sourceUrl)) {
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
  })
  const outcome = await runTurn(deps.codex, {
    threadId,
    input: textInput(`次の URL が指す論文の原本と書誌情報を調べよ: ${sourceUrl}`),
    effort: 'low',
    outputSchema: OUTPUT_SCHEMA,
  })

  const source = parseAgentResult(outcome.text)
  if (source === null) throw new Error(`URL を解決できなかった: ${sourceUrl}`)

  // エージェントが arXiv の識別子を見つけた場合も、重複の判定に使う。
  if (source.arxivId !== null) {
    const byId = deps.known.byArxivId(source.arxivId)
    if (byId !== null) return { kind: 'duplicate', slug: byId, reason: 'arxivId' }
  }

  return { kind: 'resolved', source, sourceUrl }
}
