import type { IndexDb } from '../db/index-db.ts'
import { cosine, type Embedder } from './embed.ts'
import { fuseByRank } from './fuse.ts'
import type { ChunkStore, StoredChunk } from './store.ts'

export type SearchFilter = {
  /** タイトルの部分一致。 */
  title?: string
  author?: string
  venue?: string
  yearFrom?: number
  yearTo?: number
  tags?: string[]
}

export type SearchQuery = {
  /** 語句。空なら構造化条件だけで絞る。 */
  text?: string
  filter?: SearchFilter
  limit?: number
}

export type SearchHit = {
  slug: string
  title: string
  /** 当たったチャンクの見出し経路。 */
  path: string
  /** なぜ当たったかを示す抜粋。 */
  excerpt: string
  lang: StoredChunk['lang']
  score: number
}

export type SearchDeps = {
  index: IndexDb
  chunks: ChunkStore
  embed: Embedder
}

/** 融合の前に各経路から取る件数。論文ごとの代表を選ぶ前なので多めに取る。 */
const PER_PATH = 100
const DEFAULT_LIMIT = 20
const EXCERPT = 200

/** FTS5 の演算子を持つ文字を落とし、素の語句として扱う。 */
function escapeMatch(text: string): string {
  const cleaned = text.replace(/["*()^:-]/g, ' ').trim()
  return cleaned.length === 0 ? '' : `"${cleaned}"`
}

export async function search(query: SearchQuery, deps: SearchDeps): Promise<SearchHit[]> {
  const limit = query.limit ?? DEFAULT_LIMIT
  // 構造化条件で候補の集合を決める。条件が無ければコレクション全体になる(0005)。
  const slugs = deps.index.filterSlugs(query.filter ?? {})
  if (slugs !== null && slugs.length === 0) return []

  const text = (query.text ?? '').trim()
  if (text.length === 0) {
    return titlesOnly(slugs, limit, deps)
  }

  const match = escapeMatch(text)
  const byText = match.length === 0 ? [] : deps.chunks.searchText(match, slugs, PER_PATH)

  const [queryVector] = await deps.embed([text])
  const byVector =
    queryVector === undefined
      ? []
      : deps.chunks
          .vectors(slugs)
          .map(({ chunk, vector }) => ({ id: chunk.id, score: cosine(queryVector, vector) }))
          .sort((a, b) => b.score - a.score)
          .slice(0, PER_PATH)

  const fused = fuseByRank([byText, byVector])
  const chunks = deps.chunks.byIds(fused.map((f) => f.id))

  // 検索結果は論文を単位とするので、論文ごとに最も順位の高い 1 件で代表させる(0005)。
  const best = new Map<string, SearchHit>()
  for (const { id, score } of fused) {
    const chunk = chunks.get(id)
    if (chunk === undefined || best.has(chunk.slug)) continue
    const paper = deps.index.getPaper(chunk.slug)
    if (paper === null) continue
    best.set(chunk.slug, {
      slug: chunk.slug,
      title: paper.title,
      path: chunk.path,
      excerpt: excerpt(chunk.text),
      lang: chunk.lang,
      score,
    })
    if (best.size >= limit) break
  }
  return [...best.values()]
}

/** 語句が無いときは、構造化条件に当たった論文をそのまま並べる。 */
function titlesOnly(slugs: string[] | null, limit: number, deps: SearchDeps): SearchHit[] {
  const list = slugs ?? deps.index.slugsByAdded()
  const out: SearchHit[] = []
  for (const slug of list.slice(0, limit)) {
    const paper = deps.index.getPaper(slug)
    if (paper === null) continue
    out.push({ slug, title: paper.title, path: '', excerpt: '', lang: 'en', score: 0 })
  }
  return out
}

function excerpt(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > EXCERPT ? `${flat.slice(0, EXCERPT)}…` : flat
}
