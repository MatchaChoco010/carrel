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
