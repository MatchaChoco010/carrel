import type { CodexClient } from '../codex/client.ts'
import { textInput } from '../codex/protocol.ts'
import { runTurn, startWorkThread } from '../codex/threads.ts'
import { normalizeDoi } from '../data/doi.ts'
import { readPaper, writePaper, type PaperMeta } from '../data/paper.ts'
import { extractArxivId } from '../ingest/arxiv.ts'
import { BIBLIOGRAPHY_INSTRUCTIONS, BIBLIOGRAPHY_SCHEMA, buildBibliographyPrompt } from './prompt.ts'
import { doiPointsAtPaper, lookupDoi, type DoiLookup } from './verify-doi.ts'

export type BibliographyDeps = {
  dataDir: string
  codex: CodexClient
  model: string
  effort: string
  serviceTier: string | null
  /**
   * その DOI を、コレクションの別の論文が既に持っているか(#283)。
   *
   * 渡さなければ何も弾かない。
   */
  takenDoi?: (doi: string, slug: string) => boolean
  /** DOI から書誌を引く口(#287)。差し替えられるようにして、試験では通信しない。 */
  lookupDoi?: DoiLookup
}

/** 確かめた結果。確かめられなかった項目は null で返る。 */
export type Bibliography = {
  /** 本文から読み取った標題。 */
  title: string | null
  /** 本文から読み取った著者。読み取れなければ空。 */
  authors: string[]
  venue: string | null
  year: number | null
  doi: string | null
  arxivId: string | null
  pdfUrl: string | null
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function asUrl(value: unknown): string | null {
  const text = asString(value)
  return text !== null && /^https?:\/\//i.test(text) ? text : null
}

export function parseBibliography(text: string): Bibliography | null {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return null
  }
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>

  const venue = asString(r['venue'])
  const arxivId = asString(r['arxivId'])
  return {
    title: asString(r['title']),
    authors: Array.isArray(r['authors'])
      ? r['authors'].filter((a): a is string => typeof a === 'string' && a.trim().length > 0).map((a) => a.trim())
      : [],
    // プレプリントの投稿先は学会名ではない(0020)。指示でも断っているが、書かれて返ることがある。
    venue: venue !== null && /^(arxiv|arxiv preprint|preprint|biorxiv|ssrn)$/i.test(venue) ? null : venue,
    year: typeof r['year'] === 'number' && Number.isInteger(r['year']) ? r['year'] : null,
    doi: normalizeDoi(asString(r['doi'])),
    arxivId: arxivId === null ? null : (extractArxivId(arxivId) ?? arxivId),
    pdfUrl: asUrl(r['pdfUrl']),
  }
}

/**
 * 確かめた書誌を frontmatter へ入れる。
 *
 * 触るのは標題と著者と出所に関わる項目だけである。slug・タグ・追加日時・`source_url` は、
 * 取り込みを始めたときの事実か、ユーザーだけが決めるものなので変えない(0020)。
 * 確かめられなかった項目は、いまの値をそのまま残す。
 *
 * `takenDoi` には、コレクションの別の論文が既に持っている DOI かを答える口を渡す。
 * DOI は出版物を一意に指すので、別の論文が持っているなら、その DOI はこの論文のもの
 * ではない(#283)。空のまま次へ進める。
 */
export function mergeBibliography(
  meta: PaperMeta,
  found: Bibliography,
  takenDoi: (doi: string) => boolean = () => false,
): PaperMeta {
  const doi = found.doi !== null && !takenDoi(found.doi) ? found.doi : meta.doi
  return {
    ...meta,
    title: found.title ?? meta.title,
    authors: found.authors.length > 0 ? found.authors : meta.authors,
    venue: found.venue ?? meta.venue,
    year: found.year ?? meta.year,
    doi,
    arxivId: found.arxivId ?? meta.arxivId,
    pdfUrl: found.pdfUrl ?? meta.pdfUrl,
  }
}

/**
 * 本文が確定した論文の書誌を web で確かめ、frontmatter を直す(0020)。
 *
 * 確かめられなければ何も直さずに返る。学会名が空でも論文は読めるので、ここで
 * 取り込みを止めない。
 */
export async function lookupBibliography(slug: string, deps: BibliographyDeps): Promise<Bibliography | null> {
  const paper = await readPaper(deps.dataDir, slug)
  if (paper === null) throw new Error(`論文が読めない: ${slug}`)

  const threadId = await startWorkThread(deps.codex, {
    instructions: BIBLIOGRAPHY_INSTRUCTIONS,
    model: deps.model,
    serviceTier: deps.serviceTier,
    webSearch: true,
  })
  const outcome = await runTurn(deps.codex, {
    threadId,
    input: textInput(
      buildBibliographyPrompt({
        head: paper.body,
        title: paper.meta.title,
        authors: paper.meta.authors,
        year: paper.meta.year,
      }),
    ),
    effort: deps.effort,
    outputSchema: BIBLIOGRAPHY_SCHEMA,
  })

  const found = parseBibliography(outcome.text)
  if (found === null) return null

  // 挙がった DOI がこの論文を指しているかを確かめる(#287)。同じ予稿集の中の別の論文の
  // 番号が入ることがあり、組み立てられる形なので当てずっぽうでも DOI らしく見える。
  const pointsHere =
    found.doi === null ||
    (await doiPointsAtPaper(found.doi, found.title ?? paper.meta.title, deps.lookupDoi ?? lookupDoi))
  const verified = pointsHere ? found : { ...found, doi: null }

  const merged = mergeBibliography(paper.meta, verified, (doi) => deps.takenDoi?.(doi, slug) ?? false)
  await writePaper(deps.dataDir, merged, paper.body)
  return verified
}
