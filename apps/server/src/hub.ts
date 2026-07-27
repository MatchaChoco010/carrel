import type { WebSocket } from 'ws'

// サーバーで起きた変化をクライアントへ push する口(0001「クライアントとサーバーの責務境界」)。
//
// 未読件数もジョブの進捗も残枠も、クライアントの操作と無関係に変わり、
// しかも複数のクライアントが同時に見ている。そのため変化はサーバーが起点になり、
// クライアントは受け取って表示するだけにする。

/** クライアントへ送る出来事。種別ごとの payload は各機能の実装で足す。 */
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

  /** 接続中のすべてのクライアントへ送る。送れなかった相手は取り除く。 */
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
        // 閉じられない相手は放置してよい。プロセスの終了で片付く。
      }
    }
    this.#clients.clear()
  }
}
