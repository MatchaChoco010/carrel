import type { ResolvedSource } from './types.ts'

// 2007 年 4 月以降の識別子(0704.0001 形式)と、それ以前の識別子(math/0309136 形式)。
const MODERN_ID = /(\d{4}\.\d{4,5})(v\d+)?/
const LEGACY_ID = /([a-z-]+(?:\.[A-Z]{2})?\/\d{7})(v\d+)?/

export function isArxivUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '')
    return host === 'arxiv.org' || host === 'export.arxiv.org'
  } catch {
    return false
  }
}

/** URL または識別子そのものから、バージョンを除いた arXiv の識別子を取り出す。 */
export function extractArxivId(value: string): string | null {
  const modern = MODERN_ID.exec(value)
  if (modern !== null) return modern[1] as string
  const legacy = LEGACY_ID.exec(value)
  if (legacy !== null) return legacy[1] as string
  return null
}

function text(xml: string, tag: string): string | null {
  const match = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`).exec(xml)
  if (match === null) return null
  const value = decodeEntities((match[1] as string).replace(/\s+/g, ' ').trim())
  return value.length > 0 ? value : null
}

function decodeEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
}

/** entry 要素だけを切り出す。feed 全体のタイトルを論文のタイトルと取り違えないため。 */
function entryOf(xml: string): string | null {
  const match = /<entry>([\s\S]*?)<\/entry>/.exec(xml)
  return match === null ? null : (match[1] as string)
}

/** API の応答に並ぶ 1 件ぶんの生の値。フィードは書誌の解決とは別の形で使う。 */
export type ArxivEntry = {
  id: string | null
  title: string | null
  authors: string[]
  abstract: string | null
  published: string | null
}

/** 応答に並ぶすべての entry を取り出す。 */
export function parseArxivEntries(xml: string): ArxivEntry[] {
  return [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map((match) => {
    const entry = match[1] as string
    return {
      id: text(entry, 'id'),
      title: text(entry, 'title'),
      authors: [...entry.matchAll(/<author>\s*<name>([\s\S]*?)<\/name>/g)]
        .map((m) => decodeEntities((m[1] as string).trim()))
        .filter((name) => name.length > 0),
      abstract: text(entry, 'summary'),
      published: text(entry, 'published'),
    }
  })
}

export function parseArxivEntry(xml: string, arxivId: string): ResolvedSource | null {
  const entry = entryOf(xml)
  if (entry === null) return null

  const title = text(entry, 'title')
  if (title === null) return null

  const authors = [...entry.matchAll(/<author>\s*<name>([\s\S]*?)<\/name>/g)]
    .map((m) => decodeEntities((m[1] as string).trim()))
    .filter((name) => name.length > 0)

  const published = text(entry, 'published')
  const year = published === null ? null : Number(published.slice(0, 4))

  const pdfLink = /<link[^>]*type="application\/pdf"[^>]*>/.exec(entry)
  const href = pdfLink === null ? null : /href="([^"]+)"/.exec(pdfLink[0])?.[1]

  return {
    originalUrl: href ?? `https://arxiv.org/pdf/${arxivId}`,
    alternateUrls: [],
    kind: 'pdf',
    title,
    authors,
    year: year !== null && Number.isInteger(year) ? year : null,
    // arXiv は学会名を構造化して持たない。journal_ref があるものだけ拾う。
    venue: text(entry, 'arxiv:journal_ref'),
    abstract: text(entry, 'summary'),
    arxivId,
    doi: text(entry, 'arxiv:doi'),
    slugKeepWords: [],
    via: 'arxiv',
  }
}

export type Fetcher = (url: string) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>

/**
 * arXiv の API から書誌情報を引く。
 *
 * API は HTTPS でしか応答しない。
 */
export async function lookupArxiv(arxivId: string, fetcher: Fetcher = globalThis.fetch): Promise<ResolvedSource | null> {
  const response = await fetcher(
    `https://export.arxiv.org/api/query?id_list=${encodeURIComponent(arxivId)}&max_results=1`,
  )
  if (!response.ok) return null
  return parseArxivEntry(await response.text(), arxivId)
}
