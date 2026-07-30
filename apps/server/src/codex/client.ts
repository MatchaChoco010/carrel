import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { createInterface, type Interface } from 'node:readline'
import {
  isApprovalRequest,
  METHODS,
  type Notification,
  type RequestId,
  type ServerRequest,
} from './protocol.ts'

export type CodexClientOptions = {
  command?: string
  args?: string[]
  clientName?: string
  clientVersion?: string
  requestTimeoutMs?: number
}

export type CodexNotificationHandler = (notification: Notification) => void

/** 1 つのスレッドの通知を待つ側。 */
export type ThreadListener = {
  notify: (notification: Notification) => void
  /** これ以上そのスレッドの通知が来ないと分かったとき。 */
  fail: (error: Error) => void
}

/** サーバーからの要求に答える期限。過ぎたら断る。 */
const UNANSWERED_MS = 20_000

class CodexRequestError extends Error {
  readonly code: number
  readonly data: unknown

  constructor(method: string, code: number, message: string, data: unknown) {
    super(`${method} が失敗した (${code}): ${message}`)
    this.name = 'CodexRequestError'
    this.code = code
    this.data = data
  }
}

/**
 * `codex app-server` を子プロセスとして動かし、行区切りの JSON でやりとりする。
 *
 * やりとりするメッセージは JSON-RPC から `jsonrpc` フィールドを省いた形で、
 * 応答は `id` と `result` / `error`、通知は `id` を持たない `method` で届く。
 */
export class CodexClient extends EventEmitter {
  readonly #options: Required<CodexClientOptions>
  #child: ChildProcessWithoutNullStreams | null = null
  #reader: Interface | null = null
  #nextId = 0
  #pending = new Map<RequestId, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>()
  /** まだ答えていないサーバーからの要求。 */
  #unanswered = new Set<RequestId>()
  /** スレッドごとの通知の配り先。 */
  #threads = new Map<string, Set<ThreadListener>>()
  #stopping = false

  constructor(options: CodexClientOptions = {}) {
    super()
    this.#options = {
      command: options.command ?? 'codex',
      args: options.args ?? ['app-server'],
      clientName: options.clientName ?? 'pct',
      clientVersion: options.clientVersion ?? '0.1.0',
      requestTimeoutMs: options.requestTimeoutMs ?? 120_000,
    }
  }

  get running(): boolean {
    return this.#child !== null
  }

  async start(): Promise<void> {
    if (this.#child !== null) return

    const child = spawn(this.#options.command, this.#options.args, { stdio: ['pipe', 'pipe', 'pipe'] })
    this.#child = child
    this.#stopping = false

    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => this.emit('stderr', chunk))
    child.on('exit', (code, signal) => this.#handleExit(code, signal))

    this.#reader = createInterface({ input: child.stdout })
    this.#reader.on('line', (line) => this.#handleLine(line))

    await this.request(METHODS.initialize, {
      clientInfo: { name: this.#options.clientName, title: 'pct', version: this.#options.clientVersion },
      capabilities: null,
    })
  }

  async stop(): Promise<void> {
    this.#stopping = true
    this.#reader?.close()
    this.#reader = null
    const child = this.#child
    this.#child = null
    if (child === null) return
    child.kill('SIGTERM')
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        child.kill('SIGKILL')
        resolve()
      }, 2_000)
      child.once('exit', () => {
        clearTimeout(timer)
        resolve()
      })
    })
  }

  request(method: string, params?: unknown): Promise<unknown> {
    const child = this.#child
    if (child === null) return Promise.reject(new Error('app-server が起動していない'))

    const id = ++this.#nextId
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id)
        reject(new Error(`${method} が ${this.#options.requestTimeoutMs}ms 以内に応答しなかった`))
      }, this.#options.requestTimeoutMs)
      this.#pending.set(id, { resolve, reject, timer })
      child.stdin.write(`${JSON.stringify({ id, method, params: params ?? {} })}\n`)
    })
  }

  /**
   * スレッド宛の通知を受け取る。返り値を呼ぶと外れる。
   *
   * ターンごとに `notification` の listener を足すと、同時に流すターンの数だけ
   * 並ぶ。照合と翻訳はページと節を 8 本ずつ流すので、EventEmitter の既定の上限を
   * すぐ超える。ここで配り先を持てば、listener は最初の 1 つだけで済む。
   */
  onThread(threadId: string, listener: ThreadListener): () => void {
    const listeners = this.#threads.get(threadId) ?? new Set<ThreadListener>()
    listeners.add(listener)
    this.#threads.set(threadId, listeners)
    return () => {
      const current = this.#threads.get(threadId)
      if (current === undefined) return
      current.delete(listener)
      if (current.size === 0) this.#threads.delete(threadId)
    }
  }

  /** サーバーからの要求へ答える。`serverRequest` を受けた側が呼ぶ。 */
  respond(id: RequestId, result: unknown): void {
    this.#unanswered.delete(id)
    this.#child?.stdin.write(`${JSON.stringify({ id, result })}\n`)
  }

  #handleLine(line: string): void {
    if (line.trim().length === 0) return
    let message: Record<string, unknown>
    try {
      message = JSON.parse(line) as Record<string, unknown>
    } catch {
      this.emit('malformed', line)
      return
    }

    const id = message['id']
    const method = message['method']

    if (typeof id === 'number' && method === undefined) {
      this.#settle(id, message)
      return
    }
    if (typeof method === 'string' && typeof id === 'number') {
      this.#handleServerRequest({ id, method, params: message['params'] })
      return
    }
    if (typeof method === 'string') {
      const notification = { method, params: message['params'] } satisfies Notification
      this.emit('notification', notification)
      this.#dispatchThread(notification)
    }
  }

  #dispatchThread(notification: Notification): void {
    const params = (notification.params ?? {}) as { threadId?: unknown }
    if (typeof params.threadId !== 'string') return
    for (const listener of this.#threads.get(params.threadId) ?? []) listener.notify(notification)
  }

  #settle(id: RequestId, message: Record<string, unknown>): void {
    const entry = this.#pending.get(id)
    if (entry === undefined) return
    this.#pending.delete(id)
    clearTimeout(entry.timer)

    const error = message['error']
    if (error !== undefined && error !== null) {
      const e = error as { code?: number; message?: string; data?: unknown }
      entry.reject(new CodexRequestError('要求', e.code ?? -1, e.message ?? '不明な失敗', e.data))
      return
    }
    entry.resolve(message['result'])
  }

  /**
   * 承認の要求は自動的に断る。
   *
   * 断ったことは `approvalDeclined` として上へ伝え、エージェントが何かを試みて
   * 阻まれた事実を利用者が把握できるようにする。
   *
   * それ以外の要求は上へ渡すが、誰も答えないとターンが完了しないので、期限を切って
   * 断りを返す。
   */
  #handleServerRequest(request: ServerRequest): void {
    if (isApprovalRequest(request.method)) {
      this.respond(request.id, { decision: 'decline' })
      this.emit('approvalDeclined', request)
      return
    }

    this.#unanswered.add(request.id)
    const timer = setTimeout(() => {
      if (!this.#unanswered.has(request.id)) return
      console.error(`${request.method} に誰も答えなかったので断る`)
      this.respond(request.id, { error: { code: -32601, message: `pct は ${request.method} を扱わない` } })
    }, UNANSWERED_MS)
    timer.unref()
    this.emit('serverRequest', request)
  }

  #handleExit(code: number | null, signal: NodeJS.Signals | null): void {
    const gone = new Error(`app-server が終了した (code=${code} signal=${signal})`)
    for (const [, entry] of this.#pending) {
      clearTimeout(entry.timer)
      entry.reject(gone)
    }
    this.#pending.clear()
    // 通知を待っているターンは、要求としては既に答えが返っている。ここで知らせないと
    // 待ったまま残る。
    for (const listeners of this.#threads.values()) {
      for (const listener of listeners) listener.fail(gone)
    }
    this.#threads.clear()
    this.#child = null
    this.#reader?.close()
    this.#reader = null
    if (!this.#stopping) this.emit('exit', { code, signal })
  }
}
