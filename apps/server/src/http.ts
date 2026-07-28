import { Hono } from 'hono'
import type { CodexService } from './codex/service.ts'
import type { Collection, ScanResult } from './data/collection.ts'
import type { Config } from './config.ts'
import { mergeConfig, saveConfig } from './config.ts'
import type { IndexDb } from './db/index-db.ts'
import type { JobQueue } from './jobs/queue.ts'

export type AppDeps = {
  getConfig: () => Config
  setConfig: (config: Config) => void
  clientCount: () => number
  index: IndexDb
  collection: Collection
  rebuildIndex: () => Promise<ScanResult>
  codex: CodexService
  jobs: JobQueue
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

  app.put('/api/config', async (c) => {
    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'JSON として読めない本文が送られた' }, 400)
    }
    // 現在の設定に受け取った値を重ねてから検証する。部分的な更新をそのまま受けられる。
    const next = mergeConfig({ ...deps.getConfig(), ...(body as Record<string, unknown>) })
    await saveConfig(next)
    deps.setConfig(next)
    return c.json(next)
  })

  app.get('/api/index/status', (c) =>
    c.json({
      papers: deps.index.countPapers(),
      chats: deps.index.countChats(),
      staleEmbeddings: deps.index.staleEmbeddingSlugs().length,
      tags: deps.index.tagCounts(),
    }),
  )

  app.post('/api/index/rebuild', async (c) => c.json(await deps.rebuildIndex()))

  app.get('/api/codex/status', (c) =>
    c.json({ running: deps.codex.running, rateLimits: deps.codex.rateLimits }),
  )

  app.post('/api/codex/rate-limits/refresh', async (c) => {
    try {
      return c.json({ rateLimits: await deps.codex.refreshRateLimits() })
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 503)
    }
  })

  app.get('/api/jobs', (c) => {
    const state = c.req.query('state')
    const jobs = state === undefined ? deps.jobs.list() : deps.jobs.list([state as never])
    return c.json({ counts: deps.jobs.counts(), jobs })
  })

  app.delete('/api/papers/:slug', async (c) => {
    const slug = c.req.param('slug')
    await deps.collection.deletePaper(slug)
    return c.json({ deleted: slug })
  })

  return app
}
