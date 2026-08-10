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

/**
 * 済んだ仕事を一覧に残す量。
 *
 * 一覧は「いま何が動いていて、直前に何が終わったか」を見る場所である。取り込み 1 本が
 * 5 つの仕事になるので、直近 50 件で 10 本ぶんが残る。それより古いものは、1 日を過ぎたら
 * 捨てる。
 */
const KEEP_FINISHED = 50
const FINISHED_MAX_AGE_MS = 24 * 60 * 60 * 1000

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
  /** 走っている仕事を止めるための合図と、その仕事が片付くまで(#329)。 */
  #running = new Map<number, { stop: AbortController; settled: Promise<void> }>()

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

  /** 終わった仕事の記録を捨てる。待っている仕事と走っている仕事は残る。 */
  clearFinished(): number {
    return this.#store.clearFinished()
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
  cancelPending(target: string): { cancelled: number; running: number } {
    return this.#store.cancelPending(target)
  }

  /**
   * その対象の仕事を、待っているものも走っているものも止める(#329)。
   *
   * 走っている仕事が片付くまで待ってから返る。片付いた仕事は記録ごと消すので、
   * 呼んだ側は残骸を片付けてよい。
   *
   * 止まるまでにかかる時間は仕事による。変換器は子プロセスを終わらせるので即座に、
   * Codex を使う段階は束の切れ目までかかる。
   */
  async cancel(target: string): Promise<{ cancelled: number; stopped: number }> {
    const running = this.#store.list(['running']).filter((job) => job.target === target)
    const { cancelled } = this.#store.cancelPending(target)
    const waits: Promise<void>[] = []
    for (const job of running) {
      const entry = this.#running.get(job.id)
      if (entry === undefined) continue
      entry.stop.abort()
      waits.push(entry.settled)
    }
    await Promise.all(waits)
    return { cancelled, stopped: running.length }
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

    const stop = new AbortController()

    const task = handler(job, stop.signal)
      .then(() => {
        // 止めた仕事は、抜け方が投げるか返すかによらず記録ごと消す(#329)。
        if (stop.signal.aborted) {
          this.#store.drop(job.id)
          return
        }
        const done = this.#store.setState(job.id, 'done')
        if (done !== null) this.#onChange(done)
        this.#store.pruneFinished(KEEP_FINISHED, FINISHED_MAX_AGE_MS)
      })
      .catch((error: unknown) => {
        // 止めた仕事は失敗ではない。やり直しにも一覧にも残さない(#329)。
        if (stop.signal.aborted) {
          this.#store.drop(job.id)
          return
        }
        const message = error instanceof Error ? error.message : String(error)
        // 投げられた場所も残す。文言だけでは、どの段階のどの行で落ちたのかを後から
        // 追えない(#285)。一覧に出すのは文言だけで、こちらはログに残す。
        if (error instanceof Error && error.stack !== undefined) {
          console.error(`仕事が失敗した (${job.kind} ${job.target})`, error.stack)
        }
        const failed = this.#store.recordFailure(job.id, message, this.#retryDelayMs, this.#maxAttempts)
        if (failed !== null) this.#onChange(failed)
      })
      .finally(() => {
        this.#inFlight.delete(task)
        this.#running.delete(job.id)
        this.pump()
      })

    this.#inFlight.add(task)
    this.#running.set(job.id, { stop, settled: task })
  }
}
