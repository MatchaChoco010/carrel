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
import { readChat, renameChatToTitle, writeChat, type Chat } from './data/chat.ts'
import { FeedStore } from './feed/store.ts'
import { discardIngest, ingestFromUrl } from './ingest/pipeline.ts'
import type { IngestStore } from './ingest/store.ts'
import type { JobQueue } from './jobs/queue.ts'
import type { SearchHit, SearchQuery } from './search/search.ts'
import type { ChatSearchHit, ChatSearchQuery } from './search/chat-search.ts'
import { readPaper, readPaperSideFile, writePaper } from './data/paper.ts'
import { readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { paperAssetsDir } from './data/layout.ts'

export type AppDeps = {
  /** 論文を検索する。埋め込みを使うので非同期になる。 */
  search: (query: SearchQuery) => Promise<SearchHit[]>
  /** 会話を検索する。 */
  searchChats: (query: ChatSearchQuery) => Promise<ChatSearchHit[]>
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
  /** 選べるモデルの一覧。 */
  models: () => Promise<CodexModel[]>
  /** 会話を新しいスレッドへ載せ直す。 */
  reloadChat: (absolutePath: string) => Promise<string>
  /** 会話を分岐する。選んだ発言が属する turn の 1 つ前までを引き継ぐ(0012)。 */
  branchChat: (absolutePath: string, selected: number) => Promise<{ id: string; forked: boolean }>
  /** 会話を索引へ載せ直す。 */
  reindexChat: (absolutePath: string) => Promise<void>
  /** アーカイブの状態を切り替える。 */
  setArchived: (absolutePath: string, archived: boolean) => Promise<void>
  /** 会話を消す。markdown と Codex のスレッドを破棄する。 */
  deleteChat: (absolutePath: string) => Promise<{ threadDeleted: boolean }>
  /** フィードの取得を今すぐ積む。 */
  refreshFeed: () => void
  /** ビルド済みの Web クライアントの場所。無ければ配信しない。 */
  webRoot: string | null
}

export function createApp(deps: AppDeps): Hono {
  /** 会話の識別子から絶対パスを引く。見つからなければ null。 */
  const chatFile = (id: unknown): string | null => {
    if (typeof id !== 'string' || id.length === 0) return null
    const path = deps.index.chatPathById(id)
    return path === null ? null : join(deps.getConfig().dataDir, path)
  }

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

  app.get('/api/chats', async (c) => {
    const rows = deps.index.listChats()
    // 続きを話せるかは Codex 側の状態なので、一覧の行にも出す(0006)。
    const states = await Promise.all(rows.map((row) => deps.chats.stateOfThread(row.codex_thread_id)))
    return c.json({
      chats: rows.map((row, index) => ({ ...row, archived: row.archived !== 0, state: states[index] })),
    })
  })

  app.get('/api/chats/search', async (c) => {
    const q = c.req.query()
    const query: ChatSearchQuery = {}
    if (q['q'] !== undefined && q['q'].length > 0) query.text = q['q']
    if (q['archived'] === 'true') query.archived = true
    if (q['archived'] === 'false') query.archived = false
    for (const key of ['from', 'to'] as const) {
      const value = q[key]
      if (value !== undefined && value.length > 0) query[key] = value
    }
    try {
      return c.json({ hits: await deps.searchChats(query) })
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 502)
    }
  })

  app.post('/api/chats/branch', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { id?: unknown; index?: unknown }
    if (typeof body.index !== 'number') return c.json({ error: 'id と index を指定すること' }, 400)
    const file = chatFile(body.id)
    if (file === null) return c.json({ error: `会話が見つからない: ${String(body.id)}` }, 404)
    try {
      const branch = await deps.branchChat(file, body.index)
      return c.json(branch)
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400)
    }
  })

  app.post('/api/chats/reload', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { id?: unknown }
    const file = chatFile(body.id)
    if (file === null) return c.json({ error: `会話が見つからない: ${String(body.id)}` }, 404)
    try {
      const threadId = await deps.reloadChat(file)
      return c.json({ codexThreadId: threadId })
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 502)
    }
  })

  app.put('/api/chats/archived', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { id?: unknown; archived?: unknown }
    if (typeof body.archived !== 'boolean') return c.json({ error: 'id と archived を指定すること' }, 400)
    const file = chatFile(body.id)
    if (file === null) return c.json({ error: `会話が見つからない: ${String(body.id)}` }, 404)
    try {
      await deps.setArchived(file, body.archived)
      return c.json({ archived: body.archived })
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 404)
    }
  })

  // 消す経路は 1 つだけにする。押すだけで消える口は置かない(0006)。
  app.delete('/api/chats', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { id?: unknown; confirm?: unknown }
    if (body.confirm !== true) return c.json({ error: '確認が要る' }, 400)
    const file = chatFile(body.id)
    if (file === null) return c.json({ error: `会話が見つからない: ${String(body.id)}` }, 404)
    const result = await deps.deleteChat(file)
    return c.json({ deleted: body.id, ...result })
  })

  app.put('/api/chats/title', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { id?: unknown; title?: unknown }
    if (typeof body.title !== 'string' || body.title.trim().length === 0) {
      return c.json({ error: 'id と title を指定すること' }, 400)
    }
    const dataDir = deps.getConfig().dataDir
    const file = chatFile(body.id)
    if (file === null) return c.json({ error: `会話が見つからない: ${String(body.id)}` }, 404)
    const chat = await readChat(dataDir, file)
    if (chat === null) return c.json({ error: `会話が読めない: ${String(body.id)}` }, 404)
    // ユーザーが付けた名前は AI に上書きさせない(0002)。
    const renamed: Chat = {
      ...chat,
      meta: { ...chat.meta, title: body.title.trim(), titleSource: 'user' },
    }
    await writeChat(dataDir, renamed)
    const path = await renameChatToTitle(dataDir, renamed)
    await deps.reindexChat(join(dataDir, path))
    return c.json({ title: body.title.trim() })
  })

  // 会話の場所は `chats/YYYY/MM/DD/...` の相対パスなので、経路ではなく問い合わせで受ける。
  app.get('/api/chats/one', async (c) => {
    const id = c.req.query('id')
    const file = chatFile(id)
    if (file === null) return c.json({ error: `会話が見つからない: ${id ?? ''}` }, 404)
    const chat = await readChat(deps.getConfig().dataDir, file)
    if (chat === null) return c.json({ error: `会話が読めない: ${id ?? ''}` }, 404)
    return c.json({
      meta: chat.meta,
      messages: chat.messages,
      id: chat.meta.id,
      path: chat.path,
      running: deps.chats.isRunning(chat.path),
      state: await deps.chats.state(chat),
    })
  })

  app.post('/api/chats/messages', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      id?: unknown
      text?: unknown
      model?: unknown
      effort?: unknown
    }
    if (typeof body.text !== 'string' || body.text.trim().length === 0) {
      return c.json({ error: 'text を指定すること' }, 400)
    }
    // 識別子を省くと、この発言で会話が作られる。始めただけの空の会話を残さない。
    const target = body.id === undefined ? null : chatFile(body.id)
    if (body.id !== undefined && target === null) return c.json({ error: `会話が見つからない: ${String(body.id)}` }, 404)
    const options = {
      ...(typeof body.model === 'string' ? { model: body.model } : {}),
      ...(typeof body.effort === 'string' ? { effort: body.effort } : {}),
    }
    const sent = await deps.chats.send(target, body.text.trim(), options)
    return c.json({ id: sent.id })
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
