import type { JobStore } from './store.ts'
import {
  DEFAULT_CONCURRENCY,
  MAX_ATTEMPTS,
  type Job,
  type JobHandler,
  type JobState,
  type NewJob,
  type QuotaGate,
  type ResourceClass,
} from './types.ts'

const RESOURCES: ResourceClass[] = ['gpu', 'codex', 'network']

/** 枠を使う区分。ここだけが枠の枯渇で止まる。 */
const QUOTA_BOUND: ResourceClass = 'codex'

export type JobQueueOptions = {
  concurrency?: Partial<Record<ResourceClass, number>>
  quota?: QuotaGate
  retryDelayMs?: number
  maxAttempts?: number
  onChange?: (job: Job) => void
}

export class JobQueue {
  readonly #store: JobStore
  readonly #handlers = new Map<string, JobHandler>()
  readonly #concurrency: Record<ResourceClass, number>
  readonly #quota: QuotaGate
  readonly #retryDelayMs: number
  readonly #maxAttempts: number
  readonly #onChange: (job: Job) => void
  #started = false
  #quotaTimer: NodeJS.Timeout | null = null
  #inFlight = new Set<Promise<void>>()

  constructor(store: JobStore, options: JobQueueOptions = {}) {
    this.#store = store
    this.#concurrency = { ...DEFAULT_CONCURRENCY, ...options.concurrency }
    this.#quota = options.quota ?? { blocked: () => false, resumeAt: () => null }
    this.#retryDelayMs = options.retryDelayMs ?? 30_000
    this.#maxAttempts = options.maxAttempts ?? MAX_ATTEMPTS
    this.#onChange = options.onChange ?? (() => {})
  }

  register(kind: string, handler: JobHandler): void {
    this.#handlers.set(kind, handler)
  }

  list(states?: JobState[]): Job[] {
    return this.#store.list(states)
  }

  counts(): Record<JobState, number> {
    return this.#store.counts()
  }

  start(): void {
    if (this.#started) return
    this.#started = true
    this.#store.requeueInterrupted()
    this.pump()
  }

  stop(): void {
    this.#started = false
    if (this.#quotaTimer !== null) {
      clearTimeout(this.#quotaTimer)
      this.#quotaTimer = null
    }
  }

  enqueue(job: NewJob): Job {
    const created = this.#store.enqueue(job)
    this.#onChange(created)
    this.pump()
    return created
  }

  /** 走っている仕事が片付くまで待つ。試験と終了処理で使う。 */
  async drain(): Promise<void> {
    while (this.#inFlight.size > 0) {
      await Promise.all([...this.#inFlight])
    }
  }

  /** 枠の状態が変わったことを伝える。 */
  /** その論文の、まだ走り出していない仕事を取り消す。 */
  cancelPending(target: string): { cancelled: number; running: number } {
    return this.#store.cancelPending(target)
  }

  onQuotaChanged(): void {
    if (this.#quota.blocked()) {
      const moved = this.#store.markWaitingForQuota(QUOTA_BOUND)
      if (moved > 0) this.#scheduleQuotaRecheck()
      return
    }
    this.#store.releaseWaitingForQuota(QUOTA_BOUND)
    this.pump()
  }

  pump(): void {
    if (!this.#started) return

    if (this.#quota.blocked()) {
      this.#store.markWaitingForQuota(QUOTA_BOUND)
      this.#scheduleQuotaRecheck()
    }

    for (const resource of RESOURCES) {
      if (resource === QUOTA_BOUND && this.#quota.blocked()) continue
      while (this.#store.runningCount(resource) < (this.#concurrency[resource] ?? 1)) {
        const job = this.#store.nextRunnable(resource)
        if (job === null) break
        this.#run(job)
      }
    }
  }

  #scheduleQuotaRecheck(): void {
    if (this.#quotaTimer !== null) return
    const resumeAt = this.#quota.resumeAt()
    // 回復時刻が分からないときも、通知を取り逃した場合に備えて定期的に見直す。
    const delay = resumeAt === null ? 60_000 : Math.max(1_000, resumeAt * 1000 - Date.now())
    this.#quotaTimer = setTimeout(() => {
      this.#quotaTimer = null
      this.onQuotaChanged()
    }, delay)
  }

  #run(job: Job): void {
    const handler = this.#handlers.get(job.kind)
    if (handler === undefined) {
      const failed = this.#store.setState(job.id, 'failed', `${job.kind} を扱う処理が登録されていない`)
      if (failed !== null) this.#onChange(failed)
      return
    }

    const running = this.#store.setState(job.id, 'running')
    if (running !== null) this.#onChange(running)

    const task = handler(job)
      .then(() => {
        const done = this.#store.setState(job.id, 'done')
        if (done !== null) this.#onChange(done)
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error)
        const failed = this.#store.recordFailure(job.id, message, this.#retryDelayMs, this.#maxAttempts)
        if (failed !== null) this.#onChange(failed)
      })
      .finally(() => {
        this.#inFlight.delete(task)
        this.pump()
      })

    this.#inFlight.add(task)
  }
}
