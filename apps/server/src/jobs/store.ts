import type { DatabaseSync } from 'node:sqlite'
import type { Job, JobState, NewJob, Priority, ResourceClass } from './types.ts'

type Row = {
  id: number
  kind: string
  target: string
  resource: string
  priority: string
  state: string
  attempts: number
  available_at: number
  created_at: number
  updated_at: number
  payload: string
  last_error: string | null
}

function toJob(row: Row): Job {
  return {
    id: row.id,
    kind: row.kind,
    target: row.target,
    resource: row.resource as ResourceClass,
    priority: row.priority as Priority,
    state: row.state as JobState,
    attempts: row.attempts,
    availableAt: row.available_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    payload: row.payload.length > 0 ? (JSON.parse(row.payload) as unknown) : null,
    lastError: row.last_error,
  }
}

export class JobStore {
  readonly #db: DatabaseSync
  readonly #now: () => number

  constructor(db: DatabaseSync, now: () => number = () => Date.now()) {
    this.#db = db
    this.#now = now
  }

  enqueue(job: NewJob): Job {
    const now = this.#now()
    const row = this.#db
      .prepare(
        `insert into jobs (kind, target, resource, priority, state, attempts, available_at, created_at, updated_at, payload, last_error)
         values (?, ?, ?, ?, 'pending', 0, ?, ?, ?, ?, null)
         returning *`,
      )
      .get(
        job.kind,
        job.target,
        job.resource,
        job.priority ?? 'background',
        now,
        now,
        now,
        JSON.stringify(job.payload ?? null),
      ) as Row
    return toJob(row)
  }

  /**
   * 次に走らせる仕事を選ぶ。
   *
   * 前景を先に、同じ優先度では古いものから。再試行の待ち時間が明けていない
   * ものは対象にしない。
   */
  nextRunnable(resource: ResourceClass): Job | null {
    const row = this.#db
      .prepare(
        `select * from jobs
         where resource = ? and state = 'pending' and available_at <= ?
         order by case priority when 'foreground' then 0 else 1 end, created_at, id
         limit 1`,
      )
      .get(resource, this.#now()) as Row | undefined
    return row === undefined ? null : toJob(row)
  }

  runningCount(resource: ResourceClass): number {
    const row = this.#db
      .prepare(`select count(*) as n from jobs where resource = ? and state = 'running'`)
      .get(resource) as { n: number }
    return row.n
  }

  setState(id: number, state: JobState, lastError: string | null = null): Job | null {
    const row = this.#db
      .prepare(`update jobs set state = ?, updated_at = ?, last_error = ? where id = ? returning *`)
      .get(state, this.#now(), lastError, id) as Row | undefined
    return row === undefined ? null : toJob(row)
  }

  recordFailure(id: number, message: string, retryDelayMs: number, maxAttempts: number): Job | null {
    const now = this.#now()
    const row = this.#db
      .prepare(
        `update jobs
         set attempts = attempts + 1,
             state = case when attempts + 1 >= ? then 'failed' else 'pending' end,
             available_at = ?,
             updated_at = ?,
             last_error = ?
         where id = ?
         returning *`,
      )
      .get(maxAttempts, now + retryDelayMs, now, message, id) as Row | undefined
    return row === undefined ? null : toJob(row)
  }

  /** 枠が尽きている間、まだ走っていない codex の仕事を待機へ移す。 */
  markWaitingForQuota(resource: ResourceClass): number {
    const result = this.#db
      .prepare(`update jobs set state = 'waitingForQuota', updated_at = ? where resource = ? and state = 'pending'`)
      .run(this.#now(), resource)
    return Number(result.changes)
  }

  releaseWaitingForQuota(resource: ResourceClass): number {
    const result = this.#db
      .prepare(`update jobs set state = 'pending', updated_at = ? where resource = ? and state = 'waitingForQuota'`)
      .run(this.#now(), resource)
    return Number(result.changes)
  }

  /**
   * 起動時に、実行中のまま残っている仕事を待機へ戻す。
   *
   * 前回の終了で中断されたものなので、そのままでは誰も拾わない。
   */
  requeueInterrupted(): number {
    const result = this.#db
      .prepare(`update jobs set state = 'pending', updated_at = ? where state = 'running'`)
      .run(this.#now())
    return Number(result.changes)
  }

  get(id: number): Job | null {
    const row = this.#db.prepare('select * from jobs where id = ?').get(id) as Row | undefined
    return row === undefined ? null : toJob(row)
  }

  list(states?: JobState[]): Job[] {
    if (states === undefined || states.length === 0) {
      return (this.#db.prepare('select * from jobs order by id').all() as Row[]).map(toJob)
    }
    const placeholders = states.map(() => '?').join(', ')
    const rows = this.#db
      .prepare(`select * from jobs where state in (${placeholders}) order by id`)
      .all(...states) as Row[]
    return rows.map(toJob)
  }

  counts(): Record<JobState, number> {
    const rows = this.#db.prepare('select state, count(*) as n from jobs group by state').all() as Array<{
      state: string
      n: number
    }>
    const counts: Record<JobState, number> = {
      pending: 0,
      running: 0,
      waitingForQuota: 0,
      failed: 0,
      done: 0,
    }
    for (const row of rows) counts[row.state as JobState] = row.n
    return counts
  }

  /** 完了した古い仕事を捨てる。一覧が無限に伸びないようにする。 */
  pruneDone(keep: number): number {
    const result = this.#db
      .prepare(
        `delete from jobs where state = 'done' and id not in (
           select id from jobs where state = 'done' order by id desc limit ?
         )`,
      )
      .run(keep)
    return Number(result.changes)
  }
}
