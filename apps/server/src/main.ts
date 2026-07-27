import { serve } from '@hono/node-server'
import { mkdir } from 'node:fs/promises'
import type { Server } from 'node:http'
import { WebSocketServer } from 'ws'
import { loadConfig, type Config } from './config.ts'
import { createApp } from './http.ts'
import { Hub } from './hub.ts'
import { stateDir } from './paths.ts'

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

  const server = serve({
    fetch: app.fetch,
    hostname: config.server.host,
    port: config.server.port,
  }) as Server

  const wss = new WebSocketServer({ server, path: '/ws' })
  wss.on('connection', (socket) => hub.add(socket))

  console.log(`listening on http://${config.server.host}:${config.server.port}`)

  const shutdown = (signal: string): void => {
    console.log(`${signal} を受けたので終了する`)
    hub.closeAll()
    server.close()
    // close は既存の keep-alive 接続が閉じるのを待つため、期限を切って終了する。
    setTimeout(() => process.exit(0), 500).unref()
  }

  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))
}

await main()
