import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

export type Migration = {
  version: number
  up: string
}

export function openDatabase(file: string, migrations: Migration[]): DatabaseSync {
  mkdirSync(dirname(file), { recursive: true })
  const db = new DatabaseSync(file)
  db.exec('pragma journal_mode = wal')
  db.exec('pragma foreign_keys = on')
  applyMigrations(db, migrations)
  return db
}

function applyMigrations(db: DatabaseSync, migrations: Migration[]): void {
  db.exec('create table if not exists schema_version (version integer not null)')
  const row = db.prepare('select max(version) as version from schema_version').get() as
    | { version: number | null }
    | undefined
  const current = row?.version ?? 0

  for (const migration of migrations) {
    if (migration.version <= current) continue
    db.exec('begin')
    try {
      db.exec(migration.up)
      db.prepare('insert into schema_version (version) values (?)').run(migration.version)
      db.exec('commit')
    } catch (error) {
      db.exec('rollback')
      throw error
    }
  }
}
