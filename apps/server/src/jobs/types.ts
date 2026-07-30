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
}

export type JobHandler = (job: Job) => Promise<void>

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
