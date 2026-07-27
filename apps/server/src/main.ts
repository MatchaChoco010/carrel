import { serve } from '@hono/node-server'
import { mkdir } from 'node:fs/promises'
import type { Server } from 'node:http'
import { WebSocketServer } from 'ws'
import { resolveBindTargets } from './bind.ts'
import { loadConfig, type Config } from './config.ts'
import { createApp } from './http.ts'
import { Hub } from './hub.ts'
import { stateDir } from './paths.ts'

// pct サーバーの起動。
//
// HTTP API・WebSocket・(以降で足す)ジョブキュー・フィードの取得・MCP の口を
// 1 つのプロセスに置く(0001「プロセスの分け方」)。重い処理は子プロセスや
// 外部プロセスへ出すため、このプロセスのイベントループは塞がらない。

async function main(): Promise<void> {
  let config: Config = await loadConfig()
  await mkdir(stateDir(), { recursive: true })

  const hub = new Hub()
  const app = createApp({
    getConfig: () => config,
    setConfig: (next) => {
      config = next
    },
    clientCount: () => hub.size,
  })

  const targets = resolveBindTargets()
  const servers: Server[] = []

  for (const target of targets) {
    const server = serve({
      fetch: app.fetch,
      hostname: target.address,
      port: config.server.port,
    }) as Server

    // WebSocket は同じポートの upgrade で受ける。クライアントは HTTP と
    // WebSocket を 1 つの origin で扱えばよくなる。
    const wss = new WebSocketServer({ server, path: '/ws' })
    wss.on('connection', (socket) => hub.add(socket))

    servers.push(server)
    console.log(`listening on http://${target.address}:${config.server.port} (${target.reason})`)
  }

  if (!targets.some((t) => t.reason === 'tailscale')) {
    console.warn('tailscale のアドレスが見つからないため、ループバックだけで待ち受けている')
  }

  const shutdown = (signal: string): void => {
    console.log(`${signal} を受けたので終了する`)
    hub.closeAll()
    for (const server of servers) server.close()
    // close だけでは既存の keep-alive 接続が残るため、明示的に終了する。
    setTimeout(() => process.exit(0), 500).unref()
  }

  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))
}

await main()
