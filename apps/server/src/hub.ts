import type { WebSocket } from 'ws'

export type ServerEvent = {
  type: string
  payload: unknown
}

export class Hub {
  readonly #clients = new Set<WebSocket>()

  add(socket: WebSocket): void {
    this.#clients.add(socket)
    socket.on('close', () => this.#clients.delete(socket))
    socket.on('error', () => this.#clients.delete(socket))
  }

  get size(): number {
    return this.#clients.size
  }

  broadcast(event: ServerEvent): void {
    const text = JSON.stringify(event)
    for (const socket of this.#clients) {
      try {
        socket.send(text)
      } catch {
        this.#clients.delete(socket)
      }
    }
  }

  closeAll(): void {
    for (const socket of this.#clients) {
      try {
        socket.close()
      } catch {
        // 閉じられない相手はプロセスの終了で片付くので、ここでは無視してよい。
      }
    }
    this.#clients.clear()
  }
}
