import { CodexClient } from './client.ts'
import { MCP_SERVER_NAME, METHODS, METHODS_ELICITATION, NOTIFICATIONS, type Notification, type ServerRequest } from './protocol.ts'
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
  /** 起動時に残枠を読めなかった。app-server は使える。 */
  onRateLimitsUnavailable?: (error: unknown) => void
}

/**
 * app-server の常駐と、残枠の保持をまとめる。
 *
 * carrel の HTTP を先に開いてから起動する。会話スレッドが MCP の口を呼ぶため、
 * 逆順だと呼び出し先が用意できていない。
 */
export class CodexService {
  readonly #client: CodexClient
  readonly #events: CodexServiceEvents
  #snapshot: RateLimitSnapshot | null = null

  constructor(events: CodexServiceEvents = {}, client: CodexClient = new CodexClient()) {
    this.#client = client
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

    this.#client.on('serverRequest', (request: ServerRequest) => this.#answer(request))

    this.#client.on('exit', (info: { code: number | null }) => {
      console.error(`app-server が予期せず終了した (code=${info.code})`)
    })
  }

  /**
   * サーバーからの問いに答える。
   *
   * MCP の道具を使う前に、app-server は使ってよいかを訊いてくる。carrel 自身の口は
   * 読み取りだけを公開しており(0005)、ユーザーが会話のために用意したものなので承ける。
   * ほかのサーバーは断る。誰も答えないとターンが完了しない。
   */
  #answer(request: ServerRequest): void {
    if (request.method !== METHODS_ELICITATION) return

    const params = (request.params ?? {}) as { serverName?: unknown }
    const mine = params.serverName === MCP_SERVER_NAME
    this.#client.respond(request.id, { action: mine ? 'accept' : 'decline', content: null, _meta: null })
    if (!mine) this.#events.onApprovalDeclined?.(request.method)
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
    // 残枠は表示のための付随情報なので、読めなくても起動は続ける。ChatGPT 側が
    // 一時的に応えないだけで Codex は使えるし、turn を回せば通知で入ってくる。
    try {
      await this.refreshRateLimits()
    } catch (error) {
      this.#events.onRateLimitsUnavailable?.(error)
    }
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
