/** 同時実行数を決める区分。 */
export type ResourceClass = 'gpu' | 'codex' | 'network'

/** ユーザーが結果を待っているかどうか。 */
export type Priority = 'foreground' | 'background'

export type JobState = 'pending' | 'running' | 'waitingForQuota' | 'failed' | 'done'

export type Job = {
  id: number
  kind: string
  /** 何に対する仕事か。論文の slug やフィード項目の識別子が入る。 */
  target: string
  resource: ResourceClass
  priority: Priority
  state: JobState
  attempts: number
  /** この時刻まで実行しない。再試行の間隔を空けるのに使う。 */
  availableAt: number
  /**
   * 実行の順序を決める鍵。小さいほど先に走る(0026)。
   *
   * 取り込みの鎖に属する仕事は、その取り込みを受け付けた時刻を全段階で共有する。
   * これにより、先に受け付けた論文がどの段階でも後の論文より先に走る。
   */
  orderKey: number
  createdAt: number
  updatedAt: number
  payload: unknown
  lastError: string | null
}

export type NewJob = {
  kind: string
  target: string
  resource: ResourceClass
  priority?: Priority
  payload?: unknown
  /**
   * 実行の順序を決める鍵(0026)。渡さなければ積まれた時刻になる。
   *
   * 取り込みの鎖の外から積むときは渡すものが無いので、`undefined` も受ける。
   */
  orderKey?: number | undefined
}

/**
 * 仕事の中身。
 *
 * `signal` は止められたときに立つ(#329)。子プロセスへ渡すか、束の切れ目で見て抜ける。
 * 見ない仕事は最後まで走るので、止まるのがその仕事の終わりまで遅れる。
 */
export type JobHandler = (job: Job, signal: AbortSignal) => Promise<void>

/** 枠が尽きているかどうかを、キューへ伝える口。 */
export type QuotaGate = {
  blocked: () => boolean
  resumeAt: () => number | null
}

export const DEFAULT_CONCURRENCY: Record<ResourceClass, number> = {
  // GPU は 1 枚しかなく、変換器と埋め込みモデルがそれぞれ数 GB を要求する。
  gpu: 1,
  codex: 4,
  network: 4,
}

export const MAX_ATTEMPTS = 3
