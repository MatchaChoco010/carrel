import { join } from 'node:path'
import type { JobQueue } from '../jobs/queue.ts'
import type { Job } from '../jobs/types.ts'
import { indexChatChunks, type ChatIndexDeps } from '../search/chat-register.ts'
import { digestChat, type ChatDigestDeps } from './digest.ts'

export const CHAT_DIGEST_JOB = 'chatDigest'
export const CHAT_INDEX_JOB = 'chatIndex'

/** 次の発言をこの時間だけ待ち、会話が落ち着いてから 1 回だけ生成する(0006)。 */
export const QUIET_MS = 60_000

/**
 * タイトルと要約の生成を積む。
 *
 * 背景の優先度で積むので、ユーザーが待っている取り込みと議論に順番を譲る(0003)。
 */
export function enqueueChatDigest(queue: JobQueue, path: string): Job {
  return queue.enqueue({ kind: CHAT_DIGEST_JOB, target: path, resource: 'codex', priority: 'background' })
}

export function registerChatDigest(queue: JobQueue, deps: ChatDigestDeps & { onDone: (path: string) => void }): void {
  queue.register(CHAT_DIGEST_JOB, async (job) => {
    const digest = await digestChat(join(deps.dataDir, job.target), deps)
    if (digest !== null) deps.onDone(job.target)
  })
}

/**
 * 検索の索引付けを積む。
 *
 * 資源クラスは network で、埋め込みは Ollama への呼び出しになる。
 * ユーザーは結果を待っていないので背景で走らせる(0003)。
 */
export function enqueueChatIndex(queue: JobQueue, path: string): Job {
  return queue.enqueue({ kind: CHAT_INDEX_JOB, target: path, resource: 'network', priority: 'background' })
}

export function registerChatIndex(queue: JobQueue, deps: ChatIndexDeps): void {
  queue.register(CHAT_INDEX_JOB, async (job) => {
    await indexChatChunks(join(deps.dataDir, job.target), deps)
  })
}

/**
 * 会話ごとに、最後のターンから静かになるのを待つ。
 *
 * 待っている間に次のターンが完了したら待ち直すので、続けて発言している間は生成が
 * 積まれない。
 */
export class ChatDigestScheduler {
  readonly #timers = new Map<string, NodeJS.Timeout>()
  readonly #quietMs: number
  readonly #run: (path: string) => void

  constructor(options: { quietMs?: number; run: (path: string) => void }) {
    this.#quietMs = options.quietMs ?? QUIET_MS
    this.#run = options.run
  }

  touch(path: string): void {
    this.cancel(path)
    const timer = setTimeout(() => {
      this.#timers.delete(path)
      this.#run(path)
    }, this.#quietMs)
    // 待ちがプロセスを起こし続けないようにする。
    timer.unref()
    this.#timers.set(path, timer)
  }

  cancel(path: string): void {
    const timer = this.#timers.get(path)
    if (timer === undefined) return
    clearTimeout(timer)
    this.#timers.delete(path)
  }

  stop(): void {
    for (const path of [...this.#timers.keys()]) this.cancel(path)
  }
}
