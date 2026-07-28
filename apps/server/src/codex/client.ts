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

  #respond(id: RequestId, result: unknown): void {
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
      this.emit('notification', { method, params: message['params'] } satisfies Notification)
    }
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
   */
  #handleServerRequest(request: ServerRequest): void {
    if (isApprovalRequest(request.method)) {
      this.#respond(request.id, { decision: 'decline' })
      this.emit('approvalDeclined', request)
      return
    }
    this.emit('serverRequest', request)
  }

  #handleExit(code: number | null, signal: NodeJS.Signals | null): void {
    for (const [, entry] of this.#pending) {
      clearTimeout(entry.timer)
      entry.reject(new Error(`app-server が終了した (code=${code} signal=${signal})`))
    }
    this.#pending.clear()
    this.#child = null
    this.#reader?.close()
    this.#reader = null
    if (!this.#stopping) this.emit('exit', { code, signal })
  }
}
