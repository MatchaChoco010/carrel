import type { DatabaseSync } from 'node:sqlite'
import { fromBlob, toBlob } from './embed.ts'
import type { Segmenter } from './segment.ts'

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
  readonly #segment: Segmenter

  constructor(db: DatabaseSync, segment: Segmenter) {
    this.#db = db
    this.#segment = segment
  }

  /** その論文のチャンクを入れ替える。取り込みのやり直しで二重に積まないため。 */
  replace(slug: string, chunks: ChunkInput[]): void {
    this.#dropFromIndex(slug)
    this.#db.prepare('delete from chunks where slug = ?').run(slug)
    const insert = this.#db.prepare(
      'insert into chunks (slug, lang, position, path, text, vector) values (?, ?, ?, ?, ?, ?) returning id',
    )
    const index = this.#db.prepare('insert into chunks_fts (rowid, text) values (?, ?)')
    for (const chunk of chunks) {
      const row = insert.get(
        slug,
        chunk.lang,
        chunk.position,
        chunk.path,
        chunk.text,
        chunk.vector === null ? null : toBlob(chunk.vector),
      ) as { id: number }
      // 索引には分かち書きした語列を入れる(0019)。本文はそのまま chunks に残る。
      index.run(row.id, this.#segment(chunk.text))
    }
  }

  remove(slug: string): void {
    this.#dropFromIndex(slug)
    this.#db.prepare('delete from chunks where slug = ?').run(slug)
  }

  #dropFromIndex(slug: string): void {
    this.#db.prepare('delete from chunks_fts where rowid in (select id from chunks where slug = ?)').run(slug)
  }

  /** 索引に載っているチャンクの数。作り直しが要るかの判定に使う。 */
  countIndexed(): number {
    return (this.#db.prepare('select count(*) as n from chunks_fts').get() as { n: number }).n
  }

  /**
   * 全文検索の索引を、いまあるチャンクから作り直す。
   *
   * 分かち書きの規則を変えたときと、索引の作り方を変えたとき(0019)に走る。
   * 埋め込みは触らないので、GPU を使わずに済む。
   */
  rebuildIndex(): number {
    this.#db.prepare('delete from chunks_fts').run()
    const rows = this.#db.prepare('select id, text from chunks').all() as Array<{ id: number; text: string }>
    const index = this.#db.prepare('insert into chunks_fts (rowid, text) values (?, ?)')
    for (const row of rows) index.run(row.id, this.#segment(row.text))
    return rows.length
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
