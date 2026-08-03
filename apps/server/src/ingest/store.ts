import type { DatabaseSync } from 'node:sqlite'
import type { IngestStage } from './types.ts'

export type IngestStatus = 'inProgress' | 'failed' | 'done'

export type IngestRecord = {
  slug: string
  sourceUrl: string
  arxivId: string | null
  originalUrl: string | null
  /** 解決が読み取った題。索引に載る前でも同じ論文かを引けるようにする(#263)。 */
  title: string | null
  doi: string | null
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
  title: string | null
  doi: string | null
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
    title: row.title,
    doi: row.doi,
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

  /**
   * 取り込みの記録を作る。
   *
   * `at` には押された時刻を渡す。記録ができるのは解決が終わってからなので、既定の
   * 現在時刻にすると、解決にかかった時間が記録から抜け落ちる(#238)。
   */
  start(
    record: Omit<IngestRecord, 'stage' | 'status' | 'startedAt' | 'updatedAt' | 'lastError' | 'title' | 'doi'> &
      Partial<Pick<IngestRecord, 'title' | 'doi'>>,
    at?: number,
  ): IngestRecord {
    const now = at ?? this.#now()
    // 同じ slug をもう一度取り込むときは、前の段階の記録を残さない。残すと、済んだ
    // ことになっていない古い段階が混ざり、かかった時間が実際と合わなくなる。
    this.#db.prepare('delete from ingest_stages where slug = ?').run(record.slug)
    const row = this.#db
      .prepare(
        `insert into ingests (slug, source_url, arxiv_id, original_url, title, doi, stage, status, started_at, updated_at, last_error)
         values (?, ?, ?, ?, ?, ?, 'resolve', 'inProgress', ?, ?, null)
         on conflict (slug) do update set
           source_url = excluded.source_url,
           arxiv_id = excluded.arxiv_id,
           original_url = excluded.original_url,
           title = excluded.title,
           doi = excluded.doi,
           status = 'inProgress',
           updated_at = excluded.updated_at,
           last_error = null
         returning *`,
      )
      .get(
        record.slug,
        record.sourceUrl,
        record.arxivId,
        record.originalUrl,
        record.title ?? null,
        record.doi ?? null,
        now,
        now,
      ) as Row
    return toRecord(row)
  }

  /**
   * 失敗した取り込みを、指定の段階から動かし直す(#220)。
   *
   * 済んだ段階の記録は残したまま、状態を実行中に戻す。
   */
  resume(slug: string, stage: IngestStage): void {
    const now = this.#now()
    this.#db
      .prepare(`update ingests set stage = ?, status = 'inProgress', updated_at = ?, last_error = null where slug = ?`)
      .run(stage, now, slug)
    // 前に走っていた段階は、失敗したところで開いたまま残っている。閉じてから始めないと、
    // 画面の時計が止まらない(#280)。
    this.#closeOpenStages(slug, now)
    this.queueStage(slug, stage, now)
  }

  /**
   * 次の段階へ進める。動かせなければ false を返す(#289)。
   *
   * 段階のジョブは走っている間に取り込みが失敗することがある。実行中でなくなった
   * 記録を進めると、失敗したまま段階だけが先へ動き、記録が実際と食い違う。
   */
  advance(slug: string, stage: IngestStage): boolean {
    const record = this.get(slug)
    if (record === null || record.status !== 'inProgress') return false
    const now = this.#now()
    this.finishStage(slug, record.stage, now)
    this.queueStage(slug, stage, now)
    this.#db.prepare('update ingests set stage = ?, updated_at = ? where slug = ?').run(stage, now, slug)
    return true
  }

  /**
   * 段階を積み、そのまま走り出したと記す(#307)。
   *
   * 取得のように自分の仕事を持たず、前の段階の仕事の中で続けて走る段階に使う。
   * 待つ相手がいないので、積まれた瞬間が走り出した瞬間でもある。
   */
  advanceRunning(slug: string, stage: IngestStage): boolean {
    if (!this.advance(slug, stage)) return false
    this.beginStage(slug, stage)
    return true
  }

  /**
   * 段階を積む(0026)。走り出すまでは待機として残る。
   *
   * 積むのは取り込みの鎖で、走り出したと記すのはその段階の仕事である。書き手を分けて
   * あるので、積まれてから走り出すまでの間が記録に残る。
   */
  queueStage(slug: string, stage: IngestStage, at = this.#now()): void {
    this.#db
      .prepare(
        `insert into ingest_stages (slug, stage, queued_at, started_at, finished_at) values (?, ?, ?, null, null)
         on conflict (slug, stage) do update set queued_at = excluded.queued_at, started_at = null, finished_at = null`,
      )
      .run(slug, stage, at)
  }

  /**
   * 段階が走り出したと記す(0026)。
   *
   * 中断して走り直したときは上書きする。所要時間は走り直したぶんだけになる。
   */
  beginStage(slug: string, stage: IngestStage, at = this.#now()): void {
    this.#db
      .prepare('update ingest_stages set started_at = ?, finished_at = null where slug = ? and stage = ?')
      .run(at, slug, stage)
  }

  finishStage(slug: string, stage: IngestStage, at = this.#now()): void {
    this.#db
      .prepare(
        'update ingest_stages set finished_at = ? where slug = ? and stage = ? and started_at is not null and finished_at is null',
      )
      .run(at, slug, stage)
  }

  /**
   * 終わっていない段階を片付ける(#280、0026)。
   *
   * 走り出していた段階は、そこで終わったことにする。閉じないと、画面の時計が止まらない。
   * 積まれただけで走らなかった段階は記録から消す。終わりの時刻を入れると完了と見分けが
   * つかなくなるうえ、実際には起きていない段階だからである。
   */
  #closeOpenStages(slug: string, at: number): void {
    this.#db
      .prepare('delete from ingest_stages where slug = ? and started_at is null and finished_at is null')
      .run(slug)
    this.#db
      .prepare('update ingest_stages set finished_at = ? where slug = ? and finished_at is null')
      .run(at, slug)
  }

  /**
   * 段階ごとの時刻。3 つの埋まり方で 待機 / 実行中 / 完了 が決まる(0026)。
   *
   * 待機は `startedAt` が null、実行中は `finishedAt` が null、完了は両方が埋まっている。
   */
  stages(slug: string): Array<{
    stage: IngestStage
    queuedAt: number
    startedAt: number | null
    finishedAt: number | null
  }> {
    const rows = this.#db
      .prepare('select stage, queued_at, started_at, finished_at from ingest_stages where slug = ? order by queued_at')
      .all(slug) as Array<{ stage: string; queued_at: number; started_at: number | null; finished_at: number | null }>
    return rows.map((r) => ({
      stage: r.stage as IngestStage,
      queuedAt: r.queued_at,
      startedAt: r.started_at,
      finishedAt: r.finished_at,
    }))
  }

  /** 取り込みを終わりにする。既に失敗している記録は動かさず、false を返す(#289)。 */
  finish(slug: string): boolean {
    const record = this.get(slug)
    if (record === null || record.status !== 'inProgress') return false
    const now = this.#now()
    // 飛ばした段階が開いたまま残ることがあるので、まとめて閉じる(#280)。
    this.#closeOpenStages(slug, now)
    this.#db
      .prepare(`update ingests set status = 'done', stage = 'register', updated_at = ? where slug = ?`)
      .run(now, slug)
    return true
  }

  fail(slug: string, message: string): void {
    const now = this.#now()
    // 走っていた段階を閉じる。閉じないと、失敗した後も時計が動き続ける(#280)。
    this.#closeOpenStages(slug, now)
    this.#db
      .prepare(`update ingests set status = 'failed', updated_at = ?, last_error = ? where slug = ?`)
      .run(now, message, slug)
  }

  remove(slug: string): void {
    this.#db.prepare('delete from ingests where slug = ?').run(slug)
    this.#db.prepare('delete from ingest_stages where slug = ?').run(slug)
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

  /**
   * まだ登録まで進んでいない取り込みの、突き合わせに使う情報(#263)。
   *
   * 索引に載るのは登録まで進んだ論文だけなので、途中で失敗した取り込みは索引から引けない。
   * 同じ論文をもう一度入れたときに連番が付くのを避けるため、こちらからも引けるようにする。
   */
  pendingIdentities(): Array<{ slug: string; title: string; authors: string[]; doi: string | null; arxivId: string | null }> {
    const rows = this.#db
      .prepare(`select slug, title, doi, arxiv_id from ingests where status <> 'done' and title is not null`)
      .all() as Array<{ slug: string; title: string; doi: string | null; arxiv_id: string | null }>
    // 著者は記録に持たない。題と識別子だけで突き合わせる。
    return rows.map((r) => ({ slug: r.slug, title: r.title, authors: [], doi: r.doi, arxivId: r.arxiv_id }))
  }

  /** 題を持たない、まだ登録まで進んでいない取り込み(#271)。 */
  missingMetadata(): string[] {
    const rows = this.#db
      .prepare(`select slug from ingests where status <> 'done' and title is null`)
      .all() as Array<{ slug: string }>
    return rows.map((r) => r.slug)
  }

  /** 記録に題と DOI を入れる。突き合わせの材料が後から分かったときに使う(#271)。 */
  setMetadata(slug: string, title: string, doi: string | null): void {
    this.#db.prepare('update ingests set title = ?, doi = ? where slug = ?').run(title, doi, slug)
  }

  /** まだ全段階が終わっていない論文。 */
  incompleteSlugs(): Set<string> {
    const rows = this.#db.prepare(`select slug from ingests where status <> 'done'`).all() as Array<{ slug: string }>
    return new Set(rows.map((r) => r.slug))
  }

  list(): IngestRecord[] {
    return (this.#db.prepare('select * from ingests order by started_at desc').all() as Row[]).map(toRecord)
  }

  /**
   * 完了した取り込みの記録を消す(#223)。
   *
   * 消すのは記録だけで、論文はコレクションに残る。失敗した取り込みは、消すと成果物も
   * 一緒に捨てることになるので、ここでは触らない。
   */
  clearDone(): number {
    const result = this.#db.prepare(`delete from ingests where status = 'done'`).run()
    return Number(result.changes)
  }

  takenSlugs(): Set<string> {
    const rows = this.#db.prepare('select slug from ingests').all() as Array<{ slug: string }>
    return new Set(rows.map((r) => r.slug))
  }
}
