import type { DatabaseSync } from 'node:sqlite'
import type { IngestStage } from './types.ts'

export type IngestStatus = 'inProgress' | 'failed' | 'done'

export type IngestRecord = {
  slug: string
  sourceUrl: string
  arxivId: string | null
  originalUrl: string | null
  stage: IngestStage
  status: IngestStatus
  startedAt: number
  updatedAt: number
  lastError: string | null
}

type Row = {
  slug: string
  source_url: string
  arxiv_id: string | null
  original_url: string | null
  stage: string
  status: string
  started_at: number
  updated_at: number
  last_error: string | null
}

function toRecord(row: Row): IngestRecord {
  return {
    slug: row.slug,
    sourceUrl: row.source_url,
    arxivId: row.arxiv_id,
    originalUrl: row.original_url,
    stage: row.stage as IngestStage,
    status: row.status as IngestStatus,
    startedAt: row.started_at,
    updatedAt: row.updated_at,
    lastError: row.last_error,
  }
}

export class IngestStore {
  readonly #db: DatabaseSync
  readonly #now: () => number

  constructor(db: DatabaseSync, now: () => number = () => Date.now()) {
    this.#db = db
    this.#now = now
  }

  start(record: Omit<IngestRecord, 'stage' | 'status' | 'startedAt' | 'updatedAt' | 'lastError'>): IngestRecord {
    const now = this.#now()
    const row = this.#db
      .prepare(
        `insert into ingests (slug, source_url, arxiv_id, original_url, stage, status, started_at, updated_at, last_error)
         values (?, ?, ?, ?, 'resolve', 'inProgress', ?, ?, null)
         on conflict (slug) do update set
           source_url = excluded.source_url,
           arxiv_id = excluded.arxiv_id,
           original_url = excluded.original_url,
           status = 'inProgress',
           updated_at = excluded.updated_at,
           last_error = null
         returning *`,
      )
      .get(record.slug, record.sourceUrl, record.arxivId, record.originalUrl, now, now) as Row
    return toRecord(row)
  }

  advance(slug: string, stage: IngestStage): void {
    const now = this.#now()
    const current = this.get(slug)?.stage
    if (current !== undefined) this.finishStage(slug, current, now)
    this.startStage(slug, stage, now)
    this.#db.prepare('update ingests set stage = ?, updated_at = ? where slug = ?').run(stage, now, slug)
  }

  startStage(slug: string, stage: IngestStage, at = this.#now()): void {
    this.#db
      .prepare(
        `insert into ingest_stages (slug, stage, started_at, finished_at) values (?, ?, ?, null)
         on conflict (slug, stage) do update set started_at = excluded.started_at, finished_at = null`,
      )
      .run(slug, stage, at)
  }

  finishStage(slug: string, stage: IngestStage, at = this.#now()): void {
    this.#db
      .prepare('update ingest_stages set finished_at = ? where slug = ? and stage = ? and finished_at is null')
      .run(at, slug, stage)
  }

  /** 実行中の段階は finishedAt が null になる。 */
  stages(slug: string): Array<{ stage: IngestStage; startedAt: number; finishedAt: number | null }> {
    const rows = this.#db
      .prepare('select stage, started_at, finished_at from ingest_stages where slug = ? order by started_at')
      .all(slug) as Array<{ stage: string; started_at: number; finished_at: number | null }>
    return rows.map((r) => ({ stage: r.stage as IngestStage, startedAt: r.started_at, finishedAt: r.finished_at }))
  }

  finish(slug: string): void {
    const current = this.get(slug)?.stage
    if (current !== undefined) this.finishStage(slug, current)
    this.#db
      .prepare(`update ingests set status = 'done', stage = 'register', updated_at = ? where slug = ?`)
      .run(this.#now(), slug)
  }

  fail(slug: string, message: string): void {
    this.#db
      .prepare(`update ingests set status = 'failed', updated_at = ?, last_error = ? where slug = ?`)
      .run(this.#now(), message, slug)
  }

  remove(slug: string): void {
    this.#db.prepare('delete from ingests where slug = ?').run(slug)
  }

  get(slug: string): IngestRecord | null {
    const row = this.#db.prepare('select * from ingests where slug = ?').get(slug) as Row | undefined
    return row === undefined ? null : toRecord(row)
  }

  byArxivId(arxivId: string): IngestRecord | null {
    const row = this.#db.prepare('select * from ingests where arxiv_id = ? limit 1').get(arxivId) as Row | undefined
    return row === undefined ? null : toRecord(row)
  }

  bySourceUrl(url: string): IngestRecord | null {
    const row = this.#db
      .prepare('select * from ingests where source_url = ? or original_url = ? limit 1')
      .get(url, url) as Row | undefined
    return row === undefined ? null : toRecord(row)
  }

  /** まだ全段階が終わっていない論文。 */
  incompleteSlugs(): Set<string> {
    const rows = this.#db.prepare(`select slug from ingests where status <> 'done'`).all() as Array<{ slug: string }>
    return new Set(rows.map((r) => r.slug))
  }

  list(): IngestRecord[] {
    return (this.#db.prepare('select * from ingests order by started_at desc').all() as Row[]).map(toRecord)
  }

  takenSlugs(): Set<string> {
    const rows = this.#db.prepare('select slug from ingests').all() as Array<{ slug: string }>
    return new Set(rows.map((r) => r.slug))
  }
}
