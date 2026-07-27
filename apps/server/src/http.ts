import { Hono } from 'hono'
import type { Config } from './config.ts'
import { saveConfig } from './config.ts'
import { mergeConfig } from './config.ts'

export type AppDeps = {
  getConfig: () => Config
  setConfig: (config: Config) => void
  clientCount: () => number
}

export function createApp(deps: AppDeps): Hono {
  const app = new Hono()

  app.get('/api/health', (c) =>
    c.json({
      ok: true,
      pid: process.pid,
      uptimeSeconds: Math.floor(process.uptime()),
      clients: deps.clientCount(),
    }),
  )

  app.get('/api/config', (c) => c.json(deps.getConfig()))

  // 設定は既定値の上に重ねてから保存する。部分的な更新をそのまま受けられる。
  app.put('/api/config', async (c) => {
    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'JSON として読めない本文が送られた' }, 400)
    }
    const next = mergeConfig({ ...deps.getConfig(), ...(body as Record<string, unknown>) })
    await saveConfig(next)
    deps.setConfig(next)
    return c.json(next)
  })

  return app
}
