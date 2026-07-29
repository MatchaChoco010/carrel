import type { DatabaseSync } from 'node:sqlite'
import type { FeedEntry, FeedItem } from './types.ts'

type Row = {
  arxiv_id: string
  category: string
  title: string
  authors: string
  abstract: string | null
  abstract_ja: string | null
  published_at: number
  added_at: number
  read_at: number | null
  slug: string | null
}

function toItem(row: Row): FeedItem {
  return {
    arxivId: row.arxiv_id,
    category: row.category,
    title: row.title,
    authors: JSON.parse(row.authors) as string[],
    abstract: row.abstract,
    abstractJa: row.abstract_ja,
    publishedAt: row.published_at,
    addedAt: row.added_at,
    read: row.read_at !== null,
    slug: row.slug,
  }
}

export class FeedStore {
  readonly #db: DatabaseSync
  readonly #now: () => number

  constructor(db: DatabaseSync, now: () => number = () => Date.now()) {
    this.#db = db
    this.#now = now
  }

  /**
   * 取った項目を未読として入れ、新しく入った数を返す。
   *
   * 既に持っている識別子は無視する。バージョンが上がっただけの再投稿を新着にしない。
   */
  add(entries: FeedEntry[]): number {
    const insert = this.#db.prepare(
      `insert into feed_items
         (arxiv_id, category, title, authors, abstract, published_at, added_at)
       values (?, ?, ?, ?, ?, ?, ?)
       on conflict (arxiv_id) do nothing`,
    )
    const at = this.#now()
    let added = 0
    for (const entry of entries) {
      const result = insert.run(
        entry.arxivId,
        entry.category,
        entry.title,
        JSON.stringify(entry.authors),
        entry.abstract,
        entry.publishedAt,
        at,
      )
      added += Number(result.changes)
    }
    return added
  }

  /** 新しい投稿から順に返す。 */
  list(limit = 200): FeedItem[] {
    const rows = this.#db
      .prepare('select * from feed_items order by published_at desc limit ?')
      .all(limit) as Row[]
    return rows.map(toItem)
  }

  unreadCount(): number {
    const row = this.#db.prepare('select count(*) as n from feed_items where read_at is null').get() as { n: number }
    return Number(row.n)
  }

  /** 画面に出た項目を既読にし、既読になった数を返す。 */
  markRead(arxivIds: string[]): number {
    if (arxivIds.length === 0) return 0
    const update = this.#db.prepare('update feed_items set read_at = ? where arxiv_id = ? and read_at is null')
    const at = this.#now()
    let changed = 0
    for (const id of arxivIds) changed += Number(update.run(at, id).changes)
    return changed
  }

  /** 和訳が済んでいない項目。 */
  needsTranslation(limit = 50): FeedItem[] {
    const rows = this.#db
      .prepare(
        `select * from feed_items
         where abstract is not null and abstract_ja is null
         order by published_at desc limit ?`,
      )
      .all(limit) as Row[]
    return rows.map(toItem)
  }

  setAbstractJa(arxivId: string, abstractJa: string): void {
    this.#db.prepare('update feed_items set abstract_ja = ? where arxiv_id = ?').run(abstractJa, arxivId)
  }

  /** 取り込んだ論文と結びつける。フィードから同じ論文を二重に取り込ませないため。 */
  setSlug(arxivId: string, slug: string): void {
    this.#db.prepare('update feed_items set slug = ? where arxiv_id = ?').run(slug, arxivId)
  }

  get(arxivId: string): FeedItem | null {
    const row = this.#db.prepare('select * from feed_items where arxiv_id = ?').get(arxivId) as Row | undefined
    return row === undefined ? null : toItem(row)
  }

  /** そのカテゴリを次にどこから取るか。記録が無ければ null。 */
  cursor(category: string): number | null {
    const row = this.#db.prepare('select published_at from feed_cursors where category = ?').get(category) as
      | { published_at: number }
      | undefined
    return row === undefined ? null : Number(row.published_at)
  }

  setCursor(category: string, publishedAt: number): void {
    this.#db
      .prepare(
        `insert into feed_cursors (category, published_at) values (?, ?)
         on conflict (category) do update set published_at = excluded.published_at`,
      )
      .run(category, publishedAt)
  }
}
