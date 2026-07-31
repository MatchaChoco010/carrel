import type { DatabaseSync } from 'node:sqlite'
import { openDatabase, type Migration } from './sqlite.ts'

const MIGRATIONS: Migration[] = [
  {
    version: 1,
    up: `
      create table kv (
        key text primary key,
        value text not null
      );
    `,
  },
  {
    version: 2,
    up: `
      create table jobs (
        id integer primary key autoincrement,
        kind text not null,
        target text not null,
        resource text not null,
        priority text not null,
        state text not null,
        attempts integer not null default 0,
        available_at integer not null,
        created_at integer not null,
        updated_at integer not null,
        payload text not null default '',
        last_error text
      );
      create index jobs_pick on jobs (resource, state, available_at);
      create index jobs_state on jobs (state);
    `,
  },
  {
    version: 3,
    up: `
      create table ingests (
        slug text primary key,
        source_url text not null,
        arxiv_id text,
        original_url text,
        stage text not null,
        status text not null,
        started_at integer not null,
        updated_at integer not null,
        last_error text
      );
      create index ingests_arxiv on ingests (arxiv_id);
      create index ingests_source on ingests (source_url);
      create index ingests_status on ingests (status);
    `,
  },
  {
    version: 4,
    up: `
      -- 段階ごとの所要時間。どこで時間がかかっているかを画面で見せる。
      create table ingest_stages (
        slug text not null,
        stage text not null,
        started_at integer not null,
        finished_at integer,
        primary key (slug, stage)
      );
    `,
  },
  {
    version: 5,
    up: `
      -- フィードの項目。arXiv の識別子で一意とし、バージョンが上がっても増やさない。
      create table feed_items (
        arxiv_id text primary key,
        category text not null,
        title text not null,
        authors text not null,
        abstract text,
        abstract_ja text,
        published_at integer not null,
        added_at integer not null,
        read_at integer,
        slug text
      );

      create index feed_items_published on feed_items (published_at desc);

      -- カテゴリごとに最後まで取れた投稿時刻。次の取得の起点になる。
      create table feed_cursors (
        category text primary key,
        published_at integer not null
      );
    `,
  },
  {
    version: 6,
    up: `
      -- スレッドに効いているユーザーの指示(0014)。
      create table thread_instructions (
        thread_id text primary key,
        instructions text not null
      );
    `,
  },
]

/**
 * markdown に対応物を持たない運用の状態を置く。
 *
 * 索引と分けてあるので、`index.sqlite` を消して作り直しても、ここの内容は残る。
 */
export class StateDb {
  readonly #db: DatabaseSync

  constructor(file: string) {
    this.#db = openDatabase(file, MIGRATIONS)
  }

  get db(): DatabaseSync {
    return this.#db
  }

  close(): void {
    this.#db.close()
  }

  get(key: string): string | null {
    const row = this.#db.prepare('select value from kv where key = ?').get(key) as { value: string } | undefined
    return row?.value ?? null
  }

  set(key: string, value: string): void {
    this.#db
      .prepare('insert into kv (key, value) values (?, ?) on conflict (key) do update set value = excluded.value')
      .run(key, value)
  }

  delete(key: string): void {
    this.#db.prepare('delete from kv where key = ?').run(key)
  }
}
