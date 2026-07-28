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
