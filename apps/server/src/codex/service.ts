import { CodexClient } from './client.ts'
import { METHODS, NOTIFICATIONS, type Notification } from './protocol.ts'
import {
  mergeSnapshot,
  parseRateLimitSnapshot,
  toRateLimitView,
  type RateLimitSnapshot,
  type RateLimitView,
} from './rate-limits.ts'

export type CodexServiceEvents = {
  onRateLimits?: (view: RateLimitView) => void
  onApprovalDeclined?: (method: string) => void
}

/**
 * app-server の常駐と、残枠の保持をまとめる。
 *
 * pct の HTTP を先に開いてから起動する。会話スレッドが MCP の口を呼ぶため、
 * 逆順だと呼び出し先が用意できていない。
 */
export class CodexService {
  readonly #client: CodexClient
  readonly #events: CodexServiceEvents
  #snapshot: RateLimitSnapshot | null = null

  constructor(events: CodexServiceEvents = {}) {
    this.#client = new CodexClient()
    this.#events = events

    this.#client.on('notification', (notification: Notification) => {
      if (notification.method !== NOTIFICATIONS.rateLimitsUpdated) return
      const incoming = parseRateLimitSnapshot(notification.params)
      if (incoming === null) return
      this.#snapshot = mergeSnapshot(this.#snapshot, incoming)
      this.#events.onRateLimits?.(this.rateLimits as RateLimitView)
    })

    this.#client.on('approvalDeclined', (request: { method: string }) => {
      this.#events.onApprovalDeclined?.(request.method)
    })

    this.#client.on('exit', (info: { code: number | null }) => {
      console.error(`app-server が予期せず終了した (code=${info.code})`)
    })
  }

  get client(): CodexClient {
    return this.#client
  }

  get running(): boolean {
    return this.#client.running
  }

  get rateLimits(): RateLimitView | null {
    return this.#snapshot === null ? null : toRateLimitView(this.#snapshot)
  }

  async start(): Promise<void> {
    await this.#client.start()
    await this.refreshRateLimits()
  }

  async stop(): Promise<void> {
    await this.#client.stop()
  }

  async refreshRateLimits(): Promise<RateLimitView | null> {
    const result = await this.#client.request(METHODS.rateLimitsRead, {})
    const snapshot = parseRateLimitSnapshot(result)
    if (snapshot !== null) {
      this.#snapshot = mergeSnapshot(this.#snapshot, snapshot)
      this.#events.onRateLimits?.(this.rateLimits as RateLimitView)
    }
    return this.rateLimits
  }
}
