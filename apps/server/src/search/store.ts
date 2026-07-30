import type { DatabaseSync } from 'node:sqlite'
import { fromBlob, toBlob } from './embed.ts'

export type ChunkLang = 'en' | 'ja'

export type StoredChunk = {
  id: number
  slug: string
  lang: ChunkLang
  position: number
  path: string
  text: string
}

export type ChunkInput = {
  lang: ChunkLang
  position: number
  path: string
  text: string
  vector: Float32Array | null
}

export type EmbeddingModel = { model: string; dimensions: number }

export class ChunkStore {
  readonly #db: DatabaseSync

  constructor(db: DatabaseSync) {
    this.#db = db
  }

  /** その論文のチャンクを入れ替える。取り込みのやり直しで二重に積まないため。 */
  replace(slug: string, chunks: ChunkInput[]): void {
    this.#db.prepare('delete from chunks where slug = ?').run(slug)
    const insert = this.#db.prepare(
      'insert into chunks (slug, lang, position, path, text, vector) values (?, ?, ?, ?, ?, ?)',
    )
    for (const chunk of chunks) {
      insert.run(slug, chunk.lang, chunk.position, chunk.path, chunk.text, chunk.vector === null ? null : toBlob(chunk.vector))
    }
  }

  remove(slug: string): void {
    this.#db.prepare('delete from chunks where slug = ?').run(slug)
  }

  countChunks(): number {
    return (this.#db.prepare('select count(*) as n from chunks').get() as { n: number }).n
  }

  /** 埋め込みを作ったモデルを記録する。 */
  setModel(model: EmbeddingModel): void {
    this.#db
      .prepare(
        `insert into embedding_model (id, model, dimensions) values (1, ?, ?)
         on conflict (id) do update set model = excluded.model, dimensions = excluded.dimensions`,
      )
      .run(model.model, model.dimensions)
  }

  getModel(): EmbeddingModel | null {
    const row = this.#db.prepare('select model, dimensions from embedding_model where id = 1').get() as
      | { model: string; dimensions: number }
      | undefined
    return row === undefined ? null : { model: row.model, dimensions: row.dimensions }
  }

  /**
   * 記録と違うモデルなら、索引を作り直す必要がある。
   *
   * モデルを変えると既存のベクトルとは比較できなくなる(0005)。
   */
  needsRebuild(model: EmbeddingModel): boolean {
    const stored = this.getModel()
    if (stored === null) return this.countChunks() > 0
    return stored.model !== model.model || stored.dimensions !== model.dimensions
  }

  /** 構造化条件で絞った候補の中から、全文検索の順位を返す。 */
  searchText(query: string, slugs: string[] | null, limit: number): { id: number; rank: number }[] {
    const filter = slugs === null ? '' : ` and c.slug in (${slugs.map(() => '?').join(',')})`
    const rows = this.#db
      .prepare(
        `select c.id as id, rank as rank
         from chunks_fts f join chunks c on c.id = f.rowid
         where chunks_fts match ?${filter}
         order by rank limit ?`,
      )
      .all(query, ...(slugs ?? []), limit) as Array<{ id: number; rank: number }>
    return rows.map((r) => ({ id: r.id, rank: r.rank }))
  }

  /** 構造化条件で絞った候補のチャンクとベクトルを返す。 */
  vectors(slugs: string[] | null): { chunk: StoredChunk; vector: Float32Array }[] {
    const filter = slugs === null ? '' : ` where slug in (${slugs.map(() => '?').join(',')})`
    const rows = this.#db
      .prepare(`select id, slug, lang, position, path, text, vector from chunks${filter}`)
      .all(...(slugs ?? [])) as Array<{
      id: number
      slug: string
      lang: string
      position: number
      path: string
      text: string
      vector: Uint8Array | null
    }>
    const out: { chunk: StoredChunk; vector: Float32Array }[] = []
    for (const r of rows) {
      if (r.vector === null) continue
      out.push({
        chunk: { id: r.id, slug: r.slug, lang: r.lang as ChunkLang, position: r.position, path: r.path, text: r.text },
        vector: fromBlob(r.vector),
      })
    }
    return out
  }

  byIds(ids: number[]): Map<number, StoredChunk> {
    if (ids.length === 0) return new Map()
    const rows = this.#db
      .prepare(`select id, slug, lang, position, path, text from chunks where id in (${ids.map(() => '?').join(',')})`)
      .all(...ids) as Array<{ id: number; slug: string; lang: string; position: number; path: string; text: string }>
    return new Map(
      rows.map((r) => [
        r.id,
        { id: r.id, slug: r.slug, lang: r.lang as ChunkLang, position: r.position, path: r.path, text: r.text },
      ]),
    )
  }
}
