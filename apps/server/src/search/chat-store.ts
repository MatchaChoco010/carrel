import type { DatabaseSync } from 'node:sqlite'
import type { ChatRole } from '../data/chat.ts'
import { fromBlob, toBlob } from './embed.ts'

export type StoredChatChunk = {
  id: number
  chatId: string
  position: number
  role: ChatRole
  at: string
  text: string
}

export type ChatChunkInput = {
  position: number
  role: ChatRole
  at: string
  text: string
  vector: Float32Array | null
}

/** 発言のチャンクを持つ表。1 発言が 1 チャンクである(0006)。 */
export class ChatChunkStore {
  readonly #db: DatabaseSync

  constructor(db: DatabaseSync) {
    this.#db = db
  }

  /** その会話のチャンクを入れ替える。発言は追記されるので、毎回まとめて置き直す。 */
  replace(chatId: string, chunks: ChatChunkInput[]): void {
    this.#db.exec('begin')
    try {
      this.#db.prepare('delete from chat_chunks where chat_id = ?').run(chatId)
      const insert = this.#db.prepare(
        'insert into chat_chunks (chat_id, position, role, at, text, vector) values (?, ?, ?, ?, ?, ?)',
      )
      for (const chunk of chunks) {
        insert.run(
          chatId,
          chunk.position,
          chunk.role,
          chunk.at,
          chunk.text,
          chunk.vector === null ? null : toBlob(chunk.vector),
        )
      }
      this.#db.exec('commit')
    } catch (error) {
      this.#db.exec('rollback')
      throw error
    }
  }

  remove(chatId: string): void {
    this.#db.prepare('delete from chat_chunks where chat_id = ?').run(chatId)
  }

  /** 既にあるチャンクを返す。作り直しのときに、変わっていない発言のベクトルを使い回す。 */
  existing(chatId: string): { text: string; vector: Float32Array | null }[] {
    const rows = this.#db
      .prepare('select text, vector from chat_chunks where chat_id = ? order by position')
      .all(chatId) as Array<{ text: string; vector: Uint8Array | null }>
    return rows.map((r) => ({ text: r.text, vector: r.vector === null ? null : fromBlob(r.vector) }))
  }

  searchText(query: string, chatIds: string[] | null, limit: number): { id: number; rank: number }[] {
    const filter = chatIds === null ? '' : ` and c.chat_id in (${chatIds.map(() => '?').join(',')})`
    const rows = this.#db
      .prepare(
        `select c.id as id, rank as rank
         from chat_chunks_fts f join chat_chunks c on c.id = f.rowid
         where chat_chunks_fts match ?${filter}
         order by rank limit ?`,
      )
      .all(query, ...(chatIds ?? []), limit) as Array<{ id: number; rank: number }>
    return rows.map((r) => ({ id: r.id, rank: r.rank }))
  }

  vectors(chatIds: string[] | null): { chunk: StoredChatChunk; vector: Float32Array }[] {
    const filter = chatIds === null ? '' : ` where chat_id in (${chatIds.map(() => '?').join(',')})`
    const rows = this.#db
      .prepare(`select id, chat_id, position, role, at, text, vector from chat_chunks${filter}`)
      .all(...(chatIds ?? [])) as Array<{
      id: number
      chat_id: string
      position: number
      role: string
      at: string
      text: string
      vector: Uint8Array | null
    }>
    const out: { chunk: StoredChatChunk; vector: Float32Array }[] = []
    for (const r of rows) {
      if (r.vector === null) continue
      out.push({ chunk: toChunk(r), vector: fromBlob(r.vector) })
    }
    return out
  }

  byIds(ids: number[]): Map<number, StoredChatChunk> {
    if (ids.length === 0) return new Map()
    const rows = this.#db
      .prepare(
        `select id, chat_id, position, role, at, text from chat_chunks where id in (${ids.map(() => '?').join(',')})`,
      )
      .all(...ids) as Array<{ id: number; chat_id: string; position: number; role: string; at: string; text: string }>
    return new Map(rows.map((r) => [r.id, toChunk(r)]))
  }

  count(): number {
    return (this.#db.prepare('select count(*) as n from chat_chunks').get() as { n: number }).n
  }

  /** 既に索引へ載っている会話。起動時に、載っていないものだけを積むのに使う。 */
  indexedChatIds(): Set<string> {
    const rows = this.#db.prepare('select distinct chat_id from chat_chunks').all() as Array<{ chat_id: string }>
    return new Set(rows.map((r) => r.chat_id))
  }
}

function toChunk(row: {
  id: number
  chat_id: string
  position: number
  role: string
  at: string
  text: string
}): StoredChatChunk {
  return {
    id: row.id,
    chatId: row.chat_id,
    position: row.position,
    role: row.role === 'user' ? 'user' : 'assistant',
    at: row.at,
    text: row.text,
  }
}
