import type { ChatRole } from '../data/chat.ts'
import type { IndexDb } from '../db/index-db.ts'
import { cosine, type Embedder } from './embed.ts'
import { fuseByRank } from './fuse.ts'
import type { Segmenter } from './segment.ts'
import type { ChatChunkStore } from './chat-store.ts'

export type ChatSearchQuery = {
  /** 語句。空なら構造化条件だけで絞る。 */
  text?: string
  archived?: boolean
  /** 更新の日時の範囲。 */
  from?: string
  to?: string
  limit?: number
}

export type ChatSearchHit = {
  id: string
  path: string
  title: string
  updated: string
  archived: boolean
  /** 当たった発言。どちらの発言かと、その時刻を添える。 */
  role: ChatRole | null
  at: string | null
  excerpt: string
  score: number
}

export type ChatSearchDeps = {
  /** 索引と同じ規則で問い合わせを語に直す(0019)。 */
  segment: Segmenter
  index: IndexDb
  chunks: ChatChunkStore
  embed: Embedder
}

const PER_PATH = 100
const DEFAULT_LIMIT = 20
const EXCERPT = 200

/** FTS5 の演算子を持つ文字を落とし、素の語句として扱う。 */
function escapeMatch(text: string, segment: Segmenter): string {
  const cleaned = segment(text).replace(/["*()^:-]/g, ' ').trim()
  return cleaned.length === 0 ? '' : `"${cleaned}"`
}

function excerpt(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > EXCERPT ? `${flat.slice(0, EXCERPT)}…` : flat
}

/** 会話を検索する。論文と同じ 3 経路の融合を使う(0005)。 */
export async function searchChats(query: ChatSearchQuery, deps: ChatSearchDeps): Promise<ChatSearchHit[]> {
  const limit = query.limit ?? DEFAULT_LIMIT
  const filter: { archived?: boolean; from?: string; to?: string } = {}
  if (query.archived !== undefined) filter.archived = query.archived
  if (query.from !== undefined) filter.from = query.from
  if (query.to !== undefined) filter.to = query.to
  const ids = deps.index.filterChatIds(filter)
  if (ids !== null && ids.length === 0) return []

  const text = (query.text ?? '').trim()
  if (text.length === 0) return withoutText(ids, limit, deps)

  const match = escapeMatch(text, deps.segment)
  const byText = match.length === 0 ? [] : deps.chunks.searchText(match, ids, PER_PATH)

  const [queryVector] = await deps.embed([text])
  const byVector =
    queryVector === undefined
      ? []
      : deps.chunks
          .vectors(ids)
          .map(({ chunk, vector }) => ({ id: chunk.id, score: cosine(queryVector, vector) }))
          .sort((a, b) => b.score - a.score)
          .slice(0, PER_PATH)

  const fused = fuseByRank([byText, byVector])
  const chunks = deps.chunks.byIds(fused.map((f) => f.id))

  const best = new Map<string, ChatSearchHit>()
  for (const { id, score } of fused) {
    const chunk = chunks.get(id)
    if (chunk === undefined || best.has(chunk.chatId)) continue
    const chat = deps.index.getChatById(chunk.chatId)
    if (chat === null) continue
    best.set(chunk.chatId, {
      id: chat.id,
      path: chat.path,
      title: chat.title,
      updated: chat.updated,
      archived: chat.archived === 1,
      role: chunk.role,
      at: chunk.at,
      excerpt: excerpt(chunk.text),
      score,
    })
    if (best.size >= limit) break
  }
  return [...best.values()]
}

/** 語句が無いときは、構造化条件に当たった会話をそのまま並べる。 */
function withoutText(ids: string[] | null, limit: number, deps: ChatSearchDeps): ChatSearchHit[] {
  const list = ids ?? deps.index.listChats().map((c) => c.id)
  const out: ChatSearchHit[] = []
  for (const id of list.slice(0, limit)) {
    const chat = deps.index.getChatById(id)
    if (chat === null) continue
    out.push({
      id: chat.id,
      path: chat.path,
      title: chat.title,
      updated: chat.updated,
      archived: chat.archived === 1,
      role: null,
      at: null,
      excerpt: chat.summary,
      score: 0,
    })
  }
  return out
}
