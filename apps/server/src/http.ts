import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import type { CodexService } from './codex/service.ts'
import type { Collection, ScanResult } from './data/collection.ts'
import type { Config } from './config.ts'
import { mergeConfig, saveConfig } from './config.ts'
import type { IndexDb } from './db/index-db.ts'
import { extractArxivId } from './ingest/arxiv.ts'
import { ChatSessions } from './chat/session.ts'
import type { CodexModel } from './codex/models.ts'
import { readChat } from './data/chat.ts'
import { FeedStore } from './feed/store.ts'
import { discardIngest, ingestFromUrl } from './ingest/pipeline.ts'
import type { IngestStore } from './ingest/store.ts'
import type { JobQueue } from './jobs/queue.ts'
import type { SearchHit, SearchQuery } from './search/search.ts'
import { readPaper, readPaperSideFile, writePaper } from './data/paper.ts'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { paperAssetsDir } from './data/layout.ts'

export type AppDeps = {
  /** 論文を検索する。埋め込みを使うので非同期になる。 */
  search: (query: SearchQuery) => Promise<SearchHit[]>
  /** 解決と取得が済んだ論文の、残りの段階を始める。 */
  onIngested: (slug: string) => void
  getConfig: () => Config
  setConfig: (config: Config) => void
  clientCount: () => number
  index: IndexDb
  collection: Collection
  rebuildIndex: () => Promise<ScanResult>
  codex: CodexService
  jobs: JobQueue
  ingests: IngestStore
  feed: FeedStore
  chats: ChatSessions
  /** 会話を作る。 */
  createChat: (options: { model: string | null; effort: string | null; papers?: string[] }) => Promise<{ path: string }>
  /** 選べるモデルの一覧。 */
  models: () => Promise<CodexModel[]>
  /** フィードの取得を今すぐ積む。 */
  refreshFeed: () => void
  /** ビルド済みの Web クライアントの場所。無ければ配信しない。 */
  webRoot: string | null
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

  app.get('/api/search', async (c) => {
    const q = c.req.query()
    const tags = q['tags'] === undefined ? [] : q['tags'].split(',').filter((t) => t.length > 0)
    const num = (name: string): number | undefined => {
      const raw = q[name]
      if (raw === undefined) return undefined
      const value = Number(raw)
      return Number.isFinite(value) ? value : undefined
    }
    const filter: SearchQuery['filter'] = {}
    for (const key of ['title', 'author', 'venue'] as const) {
      const value = q[key]
      if (value !== undefined && value.length > 0) filter[key] = value
    }
    const yearFrom = num('yearFrom')
    if (yearFrom !== undefined) filter.yearFrom = yearFrom
    const yearTo = num('yearTo')
    if (yearTo !== undefined) filter.yearTo = yearTo
    if (tags.length > 0) filter.tags = tags

    const query: SearchQuery = { filter }
    const text = q['q']
    if (text !== undefined && text.length > 0) query.text = text
    const limit = num('limit')
    if (limit !== undefined) query.limit = limit

    try {
      return c.json({ hits: await deps.search(query) })
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 502)
    }
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

  app.post('/api/papers/import', async (c) => {
    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'JSON として読めない本文が送られた' }, 400)
    }
    const url = (body as { url?: unknown }).url
    if (typeof url !== 'string' || url.trim().length === 0) {
      return c.json({ error: 'url を指定すること' }, 400)
    }

    try {
      const result = await ingestFromUrl(url.trim(), {
        dataDir: deps.getConfig().dataDir,
        index: deps.index,
        ingests: deps.ingests,
        codex: deps.codex.client,
        model: deps.getConfig().ingest.model,
      })
      if (result.kind === 'imported') deps.onIngested(result.slug)
      // フィードから取り込んだ論文を結びつける。同じ論文を二度取り込ませないため。
      const arxivId = extractArxivId(url)
      if (arxivId !== null) deps.feed.setSlug(arxivId, result.slug)
      return c.json(result)
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 502)
    }
  })

  // `@` の補完に使う。本文は要らないので slug だけを返す。
  app.get('/api/papers/slugs', (c) => c.json({ slugs: [...deps.index.allSlugs()].sort() }))

  app.get('/api/codex/models', async (c) => c.json({ models: await deps.models() }))

  app.post('/api/chats', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      model?: unknown
      effort?: unknown
      papers?: unknown
    }
    const created = await deps.createChat({
      model: typeof body.model === 'string' ? body.model : null,
      effort: typeof body.effort === 'string' ? body.effort : null,
      papers: Array.isArray(body.papers) ? body.papers.filter((p): p is string => typeof p === 'string') : [],
    })
    return c.json(created)
  })

  // 会話の場所は `chats/YYYY/MM/DD/...` の相対パスなので、経路ではなく問い合わせで受ける。
  app.get('/api/chats/one', async (c) => {
    const path = c.req.query('path')
    if (path === undefined || path.length === 0) return c.json({ error: 'path を指定すること' }, 400)
    const dataDir = deps.getConfig().dataDir
    const chat = await readChat(dataDir, join(dataDir, path))
    if (chat === null) return c.json({ error: `会話が見つからない: ${path}` }, 404)
    return c.json({ meta: chat.meta, messages: chat.messages, path: chat.path, running: deps.chats.isRunning(chat.path) })
  })

  app.post('/api/chats/messages', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      path?: unknown
      text?: unknown
      model?: unknown
      effort?: unknown
    }
    if (typeof body.path !== 'string' || typeof body.text !== 'string' || body.text.trim().length === 0) {
      return c.json({ error: 'path と text を指定すること' }, 400)
    }
    const dataDir = deps.getConfig().dataDir
    // 応答を待たずに返す。進みは WebSocket で流す。
    void deps.chats
      .send(join(dataDir, body.path), body.text.trim(), {
        ...(typeof body.model === 'string' ? { model: body.model } : {}),
        ...(typeof body.effort === 'string' ? { effort: body.effort } : {}),
      })
      .catch(() => {})
    return c.json({ accepted: true })
  })

  app.get('/api/feed', (c) => c.json({ items: deps.feed.list(), unread: deps.feed.unreadCount() }))

  // 画面に出た項目を既読にする。何を出したかを知っているのはクライアントだけ。
  app.post('/api/feed/read', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { arxivIds?: unknown }
    const ids = Array.isArray(body.arxivIds) ? body.arxivIds.filter((v): v is string => typeof v === 'string') : []
    return c.json({ read: deps.feed.markRead(ids), unread: deps.feed.unreadCount() })
  })

  app.post('/api/feed/refresh', (c) => {
    deps.refreshFeed()
    return c.json({ queued: true })
  })

  app.get('/api/ingests', (c) =>
    c.json({
      ingests: deps.ingests.list().map((record) => ({ ...record, stages: deps.ingests.stages(record.slug) })),
    }),
  )

  app.get('/api/papers/:slug', async (c) => {
    const dataDir = deps.getConfig().dataDir
    const slug = c.req.param('slug')
    const paper = await readPaper(dataDir, slug)
    if (paper === null) return c.json({ error: `論文が見つからない: ${slug}` }, 404)
    const side = async (kind: 'bodyJa' | 'abstract' | 'abstractJa' | 'raw' | 'verification'): Promise<string | null> =>
      readPaperSideFile(dataDir, slug, kind)
    return c.json({
      meta: paper.meta,
      body: paper.body,
      bodyJa: await side('bodyJa'),
      abstract: await side('abstract'),
      abstractJa: await side('abstractJa'),
      hasRaw: (await side('raw')) !== null,
      verification: await side('verification'),
    })
  })

  app.put('/api/papers/:slug/tags', async (c) => {
    const slug = c.req.param('slug')
    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'JSON として読めない本文が送られた' }, 400)
    }
    const raw = (body ?? {}) as Record<string, unknown>
    if (!Array.isArray(raw['tags'])) return c.json({ error: 'tags が配列ではない' }, 400)
    const tags = [...new Set(raw['tags'].filter((t): t is string => typeof t === 'string' && t.trim().length > 0))]

    const dataDir = deps.getConfig().dataDir
    const paper = await readPaper(dataDir, slug)
    if (paper === null) return c.json({ error: `論文が見つからない: ${slug}` }, 404)
    // markdown を先に書く。索引はファイルの監視が拾って追随する。
    await writePaper(dataDir, { ...paper.meta, tags }, paper.body)
    return c.json({ slug, tags })
  })

  // 本文の中の図の参照(assets/...)をそのまま引けるようにする。
  app.get('/api/papers/:slug/assets/:name', async (c) => {
    const slug = c.req.param('slug')
    const name = c.req.param('name')
    // 論文のディレクトリの外へ出る名前は受け付けない。
    if (name.includes('/') || name.includes('\\') || name.startsWith('.')) {
      return c.json({ error: '図の名前が不正' }, 400)
    }
    try {
      const file = join(paperAssetsDir(deps.getConfig().dataDir, slug), name)
      const body = await readFile(file)
      const type = name.endsWith('.png') ? 'image/png' : 'image/jpeg'
      return c.body(body as unknown as ArrayBuffer, 200, { 'content-type': type, 'cache-control': 'max-age=3600' })
    } catch {
      return c.json({ error: '図が見つからない' }, 404)
    }
  })

  app.get('/api/papers/:slug/raw', async (c) => {
    const raw = await readPaperSideFile(deps.getConfig().dataDir, c.req.param('slug'), 'raw')
    if (raw === null) return c.json({ error: '照合前の本文が無い' }, 404)
    return c.json({ raw })
  })

  app.delete('/api/papers/:slug', async (c) => {
    const slug = c.req.param('slug')
    // 先に仕事を取り消す。ファイルを消してから取り消すと、その間に走り出した
    // 仕事が消えた論文を読みにいく。
    const jobs = deps.jobs.cancelPending(slug)
    await deps.collection.deletePaper(slug)
    await discardIngest(deps.getConfig().dataDir, slug, deps.ingests)
    return c.json({ deleted: slug, cancelledJobs: jobs.cancelled, runningJobs: jobs.running })
  })

  // API 以外の要求は Web クライアントへ回す。パスを持たない要求も index.html を
  // 返し、クライアント側の経路で解決させる。
  if (deps.webRoot !== null) {
    const root = deps.webRoot
    app.use('/assets/*', serveStatic({ root }))
    app.get('*', serveStatic({ root, path: 'index.html' }))
  }

  return app
}
