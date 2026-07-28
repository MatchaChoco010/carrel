import type { DatabaseSync } from 'node:sqlite'
import type { Chat } from '../data/chat.ts'
import type { Paper } from '../data/paper.ts'
import { openDatabase, type Migration } from './sqlite.ts'

const MIGRATIONS: Migration[] = [
  {
    version: 1,
    up: `
      create table papers (
        slug text primary key,
        title text not null,
        venue text,
        year integer,
        arxiv_id text,
        source_url text,
        pdf_url text,
        added_at text not null,
        mtime_ms real not null,
        body_hash text not null,
        embedding_stale integer not null default 1
      );
      create index papers_year on papers (year);
      create index papers_arxiv on papers (arxiv_id);

      create table paper_authors (
        slug text not null references papers (slug) on delete cascade,
        position integer not null,
        name text not null,
        primary key (slug, position)
      );
      create index paper_authors_name on paper_authors (name);

      create table paper_tags (
        slug text not null references papers (slug) on delete cascade,
        tag text not null,
        primary key (slug, tag)
      );
      create index paper_tags_tag on paper_tags (tag);

      create table chats (
        id text primary key,
        path text not null unique,
        created text not null,
        updated text not null,
        title text not null,
        summary text not null,
        archived integer not null,
        codex_thread_id text,
        forked_from text,
        mtime_ms real not null
      );
      create index chats_updated on chats (updated);

      create table chat_papers (
        chat_id text not null references chats (id) on delete cascade,
        slug text not null,
        primary key (chat_id, slug)
      );
      create index chat_papers_slug on chat_papers (slug);
    `,
  },
]

export type IndexedPaper = {
  slug: string
  mtimeMs: number
  bodyHash: string
}

export class IndexDb {
  readonly #db: DatabaseSync

  constructor(file: string) {
    this.#db = openDatabase(file, MIGRATIONS)
  }

  close(): void {
    this.#db.close()
  }

  /** 全走査で「変わったものだけ読み直す」判定に使う。 */
  paperFingerprints(): Map<string, IndexedPaper> {
    const rows = this.#db.prepare('select slug, mtime_ms, body_hash from papers').all() as Array<{
      slug: string
      mtime_ms: number
      body_hash: string
    }>
    return new Map(rows.map((r) => [r.slug, { slug: r.slug, mtimeMs: r.mtime_ms, bodyHash: r.body_hash }]))
  }

  chatFingerprints(): Map<string, number> {
    const rows = this.#db.prepare('select path, mtime_ms from chats').all() as Array<{
      path: string
      mtime_ms: number
    }>
    return new Map(rows.map((r) => [r.path, r.mtime_ms]))
  }

  upsertPaper(paper: Paper, embeddingStale: boolean): void {
    const { meta } = paper
    this.#db.exec('begin')
    try {
      this.#db
        .prepare(
          `insert into papers
             (slug, title, venue, year, arxiv_id, source_url, pdf_url, added_at, mtime_ms, body_hash, embedding_stale)
           values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           on conflict (slug) do update set
             title = excluded.title,
             venue = excluded.venue,
             year = excluded.year,
             arxiv_id = excluded.arxiv_id,
             source_url = excluded.source_url,
             pdf_url = excluded.pdf_url,
             added_at = excluded.added_at,
             mtime_ms = excluded.mtime_ms,
             body_hash = excluded.body_hash,
             embedding_stale = max(papers.embedding_stale, excluded.embedding_stale)`,
        )
        .run(
          meta.slug,
          meta.title,
          meta.venue,
          meta.year,
          meta.arxivId,
          meta.sourceUrl,
          meta.pdfUrl,
          meta.addedAt,
          paper.mtimeMs,
          paper.bodyHash,
          embeddingStale ? 1 : 0,
        )

      this.#db.prepare('delete from paper_authors where slug = ?').run(meta.slug)
      const insertAuthor = this.#db.prepare('insert into paper_authors (slug, position, name) values (?, ?, ?)')
      meta.authors.forEach((name, position) => insertAuthor.run(meta.slug, position, name))

      this.#db.prepare('delete from paper_tags where slug = ?').run(meta.slug)
      const insertTag = this.#db.prepare('insert or ignore into paper_tags (slug, tag) values (?, ?)')
      for (const tag of meta.tags) insertTag.run(meta.slug, tag)

      this.#db.exec('commit')
    } catch (error) {
      this.#db.exec('rollback')
      throw error
    }
  }

  deletePaper(slug: string): void {
    this.#db.prepare('delete from papers where slug = ?').run(slug)
  }

  upsertChat(chat: Chat): void {
    this.#db.exec('begin')
    try {
      this.#db
        .prepare(
          `insert into chats
             (id, path, created, updated, title, summary, archived, codex_thread_id, forked_from, mtime_ms)
           values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           on conflict (id) do update set
             path = excluded.path,
             created = excluded.created,
             updated = excluded.updated,
             title = excluded.title,
             summary = excluded.summary,
             archived = excluded.archived,
             codex_thread_id = excluded.codex_thread_id,
             forked_from = excluded.forked_from,
             mtime_ms = excluded.mtime_ms`,
        )
        .run(
          chat.meta.id,
          chat.path,
          chat.meta.created,
          chat.meta.updated,
          chat.meta.title,
          chat.meta.summary,
          chat.meta.archived ? 1 : 0,
          chat.meta.codexThreadId,
          chat.meta.forkedFrom,
          chat.mtimeMs,
        )

      this.#db.prepare('delete from chat_papers where chat_id = ?').run(chat.meta.id)
      const insert = this.#db.prepare('insert or ignore into chat_papers (chat_id, slug) values (?, ?)')
      for (const slug of chat.meta.papers) insert.run(chat.meta.id, slug)

      this.#db.exec('commit')
    } catch (error) {
      this.#db.exec('rollback')
      throw error
    }
  }

  deleteChatByPath(path: string): void {
    this.#db.prepare('delete from chats where path = ?').run(path)
  }

  /** 索引の中身を捨てる。次の走査で markdown から作り直される。 */
  reset(): void {
    this.#db.exec('begin')
    try {
      this.#db.exec('delete from chats')
      this.#db.exec('delete from papers')
      this.#db.exec('commit')
    } catch (error) {
      this.#db.exec('rollback')
      throw error
    }
  }

  markEmbeddingFresh(slug: string): void {
    this.#db.prepare('update papers set embedding_stale = 0 where slug = ?').run(slug)
  }

  staleEmbeddingSlugs(): string[] {
    const rows = this.#db.prepare('select slug from papers where embedding_stale = 1 order by slug').all() as Array<{
      slug: string
    }>
    return rows.map((r) => r.slug)
  }

  /** 同じ論文が既に取り込まれていないかを引く。 */
  findByArxivId(arxivId: string): string | null {
    const row = this.#db.prepare('select slug from papers where arxiv_id = ? limit 1').get(arxivId) as
      | { slug: string }
      | undefined
    return row?.slug ?? null
  }

  findBySourceUrl(url: string): string | null {
    const row = this.#db
      .prepare('select slug from papers where source_url = ? or pdf_url = ? limit 1')
      .get(url, url) as { slug: string } | undefined
    return row?.slug ?? null
  }

  allSlugs(): Set<string> {
    const rows = this.#db.prepare('select slug from papers').all() as Array<{ slug: string }>
    return new Set(rows.map((r) => r.slug))
  }

  countPapers(): number {
    const row = this.#db.prepare('select count(*) as n from papers').get() as { n: number }
    return row.n
  }

  countChats(): number {
    const row = this.#db.prepare('select count(*) as n from chats').get() as { n: number }
    return row.n
  }

  tagCounts(): Array<{ tag: string; count: number }> {
    const rows = this.#db
      .prepare('select tag, count(*) as count from paper_tags group by tag order by count desc, tag')
      .all() as Array<{ tag: string; count: number }>
    // node:sqlite の行は prototype を持たないので、呼び出し側へ渡す前に普通の
    // オブジェクトへ写す。
    return rows.map((r) => ({ tag: r.tag, count: r.count }))
  }
}
