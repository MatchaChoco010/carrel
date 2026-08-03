import { serveStatic } from '@hono/node-server/serve-static'
import { Hono, type Context } from 'hono'
import type { CodexService } from './codex/service.ts'
import type { Collection, ScanResult } from './data/collection.ts'
import type { Config } from './config.ts'
import { mergeConfig, saveConfig, unusableDataDir } from './config.ts'
import type { IndexDb } from './db/index-db.ts'
import { knownPaper } from './ingest/known.ts'
import { ChatSessions } from './chat/session.ts'
import type { CodexModel } from './codex/models.ts'
import { readChat, writeChat, type Chat } from './data/chat.ts'
import { isImporting, resolvingArxivIds } from './feed/importing.ts'
import { FeedStore } from './feed/store.ts'
import { discardIngest, planResume } from './ingest/pipeline.ts'
import { uploadTarget } from './ingest/job.ts'
import { stageOriginal } from './ingest/staging.ts'
import type { IngestStore } from './ingest/store.ts'
import type { IngestStage } from './ingest/types.ts'
import type { JobQueue } from './jobs/queue.ts'
import type { Job } from './jobs/types.ts'
import type { SearchHit, SearchQuery } from './search/search.ts'
import type { ChatSearchHit, ChatSearchQuery } from './search/chat-search.ts'
import { readPaper, readPaperSideFile, writePaper } from './data/paper.ts'
import { readReferences } from './data/references.ts'
import { matchReferences } from './references/match.ts'
import { findPaper, titleIndex } from './search/find-paper.ts'
import { readFile } from 'node:fs/promises'
import { extname, join, relative } from 'node:path'
import { chatAssetsDirOf, paperAssetsDir } from './data/layout.ts'
import { unsupportedImageType, type IncomingImage } from './chat/attachments.ts'
import { createMcpApp } from './mcp/server.ts'

export type AppDeps = {
  /** 論文を検索する。埋め込みを使うので非同期になる。 */
  search: (query: SearchQuery) => Promise<SearchHit[]>
  /** 会話を検索する。 */
  searchChats: (query: ChatSearchQuery) => Promise<ChatSearchHit[]>
  /** 取り込みを積む。解決も取得も仕事の中で行うので、押した時点では待たせない(0004)。 */
  enqueueResolve: (url: string) => Job
  /** 失敗した取り込みを、済んだ段階の続きから積む(#220)。 */
  resumeIngest: (slug: string, stage: IngestStage) => Promise<Job>
  /** 参考文献の段階を積む。取り込みより前に入れた論文と、失敗した論文の積み直しに使う(0015)。 */
  enqueueReferences: (slug: string) => Job
  /**
   * コレクションの置き場所。
   *
   * 起動時に決まった値を渡す。設定を書き替えても動いている間は変えない。索引と走査と
   * ジョブは起動時の場所に紐づいているので、要求ごとに読み直すと取り込みが新しい場所へ
   * 書いて変換が古い場所を読む。
   */
  dataDir: string
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
  /** 直前のやりとりを取り消す。落とした発言の本文を返す(0018)。 */
  undoChat: (absolutePath: string) => Promise<{ text: string }>
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
  /** 状態のディレクトリ。手元から上げた原本の置き場をこの下に持つ(0021)。 */
  stateDir: string
}

/** 受け取る画像の形式(0013)。 */
const IMAGE_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
}

function isSafeAssetName(name: string): boolean {
  return !name.includes('/') && !name.includes('\\') && !name.startsWith('.')
}

async function sendImage(c: Context, file: string, missing: string): Promise<Response> {
  const type = IMAGE_TYPES[extname(file).toLowerCase()]
  if (type === undefined) return c.json({ error: '扱わない形式' }, 415)
  try {
    const body = await readFile(file)
    return c.body(body as unknown as ArrayBuffer, 200, { 'content-type': type, 'cache-control': 'max-age=3600' })
  } catch {
    return c.json({ error: missing }, 404)
  }
}

/** 発言の送信で受け取るもの。画像を添えるときは multipart で届く(0013)。 */
type Sending = {
  id?: string
  text: string
  model?: string
  effort?: string
  images: IncomingImage[]
}

async function readSending(c: Context): Promise<Sending> {
  const text = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined)

  if (!(c.req.header('content-type') ?? '').startsWith('multipart/form-data')) {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>
    return {
      ...(text(body['id']) === undefined ? {} : { id: text(body['id']) as string }),
      text: (text(body['text']) ?? '').trim(),
      ...(text(body['model']) === undefined ? {} : { model: text(body['model']) as string }),
      ...(text(body['effort']) === undefined ? {} : { effort: text(body['effort']) as string }),
      images: [],
    }
  }

  const form = await c.req.parseBody({ all: true })
  const files = form['images']
  const list = files === undefined ? [] : Array.isArray(files) ? files : [files]
  const images: IncomingImage[] = []
  for (const file of list) {
    if (!(file instanceof File)) continue
    images.push({ name: file.name, type: file.type, bytes: new Uint8Array(await file.arrayBuffer()) })
  }
  return {
    ...(text(form['id']) === undefined ? {} : { id: text(form['id']) as string }),
    text: (text(form['text']) ?? '').trim(),
    ...(text(form['model']) === undefined ? {} : { model: text(form['model']) as string }),
    ...(text(form['effort']) === undefined ? {} : { effort: text(form['effort']) as string }),
    images,
  }
}

export function createApp(deps: AppDeps): Hono {
  /** 会話の識別子から絶対パスを引く。見つからなければ null。 */
  const chatFile = (id: unknown): string | null => {
    if (typeof id !== 'string' || id.length === 0) return null
    const path = deps.index.chatPathById(id)
    return path === null ? null : join(deps.dataDir, path)
  }

  const app = new Hono()

  app.get('/api/health', (c) =>
    c.json({
      ok: true,
      pid: process.pid,
      uptimeSeconds: Math.floor(process.uptime()),
      clients: deps.clientCount(),
      // 動いているサーバーが使っている場所。保存した設定とは違いうる。
      dataDir: deps.dataDir,
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
    if (next.dataDir !== deps.getConfig().dataDir) {
      const problem = await unusableDataDir(next.dataDir)
      if (problem !== null) return c.json({ error: problem }, 400)
    }
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

  app.post('/api/jobs/clear', (c) => c.json({ cleared: deps.jobs.clearFinished(), counts: deps.jobs.counts() }))

  app.post('/api/papers/import', async (c) => {
    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'JSON として読めない本文が送られた' }, 400)
    }
    const url = (body as { url?: unknown }).url
    if (typeof url !== 'string' || url.trim().length === 0) {
      return c.json({ error: 'URL か題名を指定すること' }, 400)
    }
    const target = url.trim()

    // 解決を待たずに分かる重複だけ、ここで断る。それ以外は解決の仕事が見つける。
    const known = knownPaper(target, { index: deps.index, ingests: deps.ingests })
    if (known !== null && known.state !== 'failed') {
      return c.json({ kind: 'duplicate', slug: known.slug, state: known.state })
    }

    // 失敗した取り込みを押し直したときは、そこから続ける(#220)。
    if (known !== null) {
      const record = deps.ingests.get(known.slug)
      if (record !== null) {
        const plan = await planResume(deps.dataDir, record)
        if (plan.kind === 'unavailable') return c.json({ error: plan.reason }, 409)
        if (plan.kind === 'continue') {
          deps.ingests.resume(plan.slug, plan.stage)
          const job = await deps.resumeIngest(plan.slug, plan.stage)
          return c.json({ kind: 'resumed', slug: plan.slug, stage: plan.stage, job })
        }
        // 原本を持たない取り込みは、成果物を捨てて所在を探すところからやり直す。
        await discardIngest(deps.dataDir, known.slug, deps.ingests)
        return c.json({ kind: 'restarted', slug: known.slug, job: deps.enqueueResolve(plan.target) })
      }
    }

    return c.json({ kind: 'queued', job: deps.enqueueResolve(target) })
  })

  /**
   * 手元の PDF を原本として預かる(0021)。
   *
   * 本文をそのまま PDF として受け取る。multipart にしないのは、数百 MB の原本を
   * メモリに載せずにディスクへ流すためである。ファイル名は問い合わせの文字列で受ける。
   */
  app.post('/api/papers/upload', async (c) => {
    const name = c.req.query('name') ?? 'original.pdf'
    const body = c.req.raw.body
    if (body === null) return c.json({ error: '原本の中身が送られていない' }, 400)
    try {
      const staged = await stageOriginal(deps.stateDir, name, body)
      // 預かったらそのまま取り込みを積む。押した時点では論文が何かも分からないので、
      // 解決の仕事が原本の先頭を読んで決める(0021)。
      const job = deps.enqueueResolve(uploadTarget(staged.id))
      return c.json({ kind: 'queued', job, name: staged.name, bytes: staged.bytes })
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400)
    }
  })

  // `@` の補完と、チャットの参照の短縮に使う(0024)。本文は要らない。
  app.get('/api/papers/slugs', (c) => c.json({ slugs: deps.index.slugIndex() }))

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

  app.post('/api/chats/undo', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { id?: unknown }
    const file = chatFile(body.id)
    if (file === null) return c.json({ error: `会話が見つからない: ${String(body.id)}` }, 404)
    try {
      return c.json(await deps.undoChat(file))
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
    const dataDir = deps.dataDir
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
    await deps.reindexChat(join(dataDir, renamed.path))
    return c.json({ title: body.title.trim() })
  })

  // 会話の場所は `chats/YYYY/MM/DD/...` の相対パスなので、経路ではなく問い合わせで受ける。
  app.get('/api/chats/one', async (c) => {
    const id = c.req.query('id')
    const file = chatFile(id)
    if (file === null) return c.json({ error: `会話が見つからない: ${id ?? ''}` }, 404)
    const chat = await readChat(deps.dataDir, file)
    if (chat === null) return c.json({ error: `会話が読めない: ${id ?? ''}` }, 404)
    return c.json({
      meta: chat.meta,
      messages: chat.messages,
      id: chat.meta.id,
      path: chat.path,
      // 走っているかの鍵は会話の実体の場所である。`chat.path` はコレクションからの
      // 相対なので、そのまま渡すと常に走っていないことになる。
      running: deps.chats.isRunning(file),
      // 開き直した画面が、書いている途中の応答を取り戻すための土台(#262)。
      partial: deps.chats.partialAnswer(file),
      state: await deps.chats.state(chat),
    })
  })

  app.post('/api/chats/messages', async (c) => {
    let sending: Sending
    try {
      sending = await readSending(c)
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400)
    }
    if (sending.text.length === 0 && sending.images.length === 0) {
      return c.json({ error: '本文か画像を指定すること' }, 400)
    }
    const bad = sending.images.find((image) => unsupportedImageType(image.type))
    if (bad !== undefined) return c.json({ error: `扱わない形式: ${bad.type}` }, 415)

    // 識別子を省くと、この発言で会話が作られる。始めただけの空の会話を残さない。
    const target = sending.id === undefined ? null : chatFile(sending.id)
    if (sending.id !== undefined && target === null) {
      return c.json({ error: `会話が見つからない: ${sending.id}` }, 404)
    }
    const options = {
      ...(sending.model === undefined ? {} : { model: sending.model }),
      ...(sending.effort === undefined ? {} : { effort: sending.effort }),
      images: sending.images,
    }
    const sent = await deps.chats.send(target, sending.text, options)
    return c.json({ id: sent.id })
  })

  app.get('/api/feed', (c) => {
    // 押した論文がすぐ実行中に見えるようにする(#295)。記録になる前の解決も数える。
    const resolving = resolvingArxivIds(deps.jobs.list(['pending', 'running']))
    const items = deps.feed.list().map((item) => ({
      ...item,
      importing: isImporting(item.arxivId, deps.ingests.byArxivId(item.arxivId), resolving),
    }))
    return c.json({ items, unread: deps.feed.unreadCount() })
  })

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

  // 完了した取り込みの記録を消す。論文は残る(#223)。
  app.post('/api/ingests/clear', (c) => c.json({ cleared: deps.ingests.clearDone() }))

  // 失敗した取り込みを捨てる。半端な成果物も一緒に消す(#223)。
  app.delete('/api/ingests/:slug', async (c) => {
    const slug = c.req.param('slug')
    const record = deps.ingests.get(slug)
    if (record === null) return c.json({ error: `取り込みの記録が無い: ${slug}` }, 404)
    const jobs = deps.jobs.cancelPending(slug)
    await discardIngest(deps.dataDir, slug, deps.ingests)
    return c.json({ discarded: slug, cancelledJobs: jobs.cancelled })
  })

  /**
   * 失敗した取り込みを、続きから積み直す(#285)。
   *
   * 解決が済んでいるなら、そこからやり直す必要は無い。成果物の有無から次に走らせる
   * 段階を決める(#220)。
   */
  app.post('/api/ingests/:slug/retry', async (c) => {
    const slug = c.req.param('slug')
    const record = deps.ingests.get(slug)
    if (record === null) return c.json({ error: `取り込みの記録が見つからない: ${slug}` }, 404)
    if (record.status === 'inProgress') return c.json({ error: 'この取り込みはいま走っている' }, 409)

    const plan = await planResume(deps.dataDir, record)
    if (plan.kind === 'unavailable') return c.json({ error: plan.reason }, 409)
    if (plan.kind === 'continue') {
      deps.ingests.resume(plan.slug, plan.stage)
      const job = await deps.resumeIngest(plan.slug, plan.stage)
      return c.json({ kind: 'resumed', slug: plan.slug, stage: plan.stage, job })
    }
    // 原本を持たない取り込みは、成果物を捨てて所在を探すところからやり直す。
    await discardIngest(deps.dataDir, slug, deps.ingests)
    return c.json({ kind: 'restarted', slug, job: deps.enqueueResolve(plan.target) })
  })

  app.get('/api/ingests', (c) =>
    c.json({
      ingests: deps.ingests.list().map((record) => ({ ...record, stages: deps.ingests.stages(record.slug) })),
    }),
  )

  app.get('/api/papers/:slug', async (c) => {
    const dataDir = deps.dataDir
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

  app.get('/api/papers/:slug/references', async (c) => {
    const slug = c.req.param('slug')
    const stored = await readReferences(deps.dataDir, slug)
    // まだ段階が走っていない論文と、参考文献が 1 件も無い論文を見分けられるようにする。
    if (stored === null) return c.json({ references: null })

    const matched = matchReferences(stored.references, {
      byArxivId: (id) => deps.index.findByArxivId(id),
      byDoi: (doi) => deps.index.findByDoi(doi),
      titles: deps.index.titles(),
    })
    return c.json({
      references: stored.references.map((reference, at) => ({ ...reference, importedSlug: matched[at] ?? null })),
    })
  })

  app.post('/api/papers/:slug/references', async (c) => {
    const slug = c.req.param('slug')
    const paper = await readPaper(deps.dataDir, slug)
    if (paper === null) return c.json({ error: `論文が見つからない: ${slug}` }, 404)
    return c.json({ job: deps.enqueueReferences(slug) })
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

    const dataDir = deps.dataDir
    const paper = await readPaper(dataDir, slug)
    if (paper === null) return c.json({ error: `論文が見つからない: ${slug}` }, 404)
    // markdown を先に書く。索引はファイルの監視が拾って追随する。
    await writePaper(dataDir, { ...paper.meta, tags }, paper.body)
    return c.json({ slug, tags })
  })

  // 本文の中の図の参照(assets/...)をそのまま引けるようにする。
  app.get('/api/papers/:slug/assets/:name', async (c) => {
    const name = c.req.param('name')
    if (!isSafeAssetName(name)) return c.json({ error: '図の名前が不正' }, 400)
    return sendImage(c, join(paperAssetsDir(deps.dataDir, c.req.param('slug')), name), '図が見つからない')
  })

  // 会話の本文が指す添付(assets/...)を引く(0013)。
  app.get('/api/chats/:id/assets/:name', async (c) => {
    const name = c.req.param('name')
    if (!isSafeAssetName(name)) return c.json({ error: '添付の名前が不正' }, 400)
    const file = chatFile(c.req.param('id'))
    if (file === null) return c.json({ error: '会話が見つからない' }, 404)
    return sendImage(c, join(chatAssetsDirOf(file), name), '添付が見つからない')
  })

  app.get('/api/papers/:slug/raw', async (c) => {
    const raw = await readPaperSideFile(deps.dataDir, c.req.param('slug'), 'raw')
    if (raw === null) return c.json({ error: '照合前の本文が無い' }, 404)
    return c.json({ raw })
  })

  app.delete('/api/papers/:slug', async (c) => {
    const slug = c.req.param('slug')
    // 先に仕事を取り消す。ファイルを消してから取り消すと、その間に走り出した
    // 仕事が消えた論文を読みにいく。
    const jobs = deps.jobs.cancelPending(slug)
    await deps.collection.deletePaper(slug)
    await discardIngest(deps.dataDir, slug, deps.ingests)
    return c.json({ deleted: slug, cancelledJobs: jobs.cancelled, runningJobs: jobs.running })
  })

  // 議論中のエージェントが接続する口(0005)。Web クライアントへ回す前に置く。
  app.route(
    '/mcp',
    createMcpApp({
      dataDir: deps.dataDir,
      search: deps.search,
      tags: () => deps.index.tagCounts(),
      findPaper: (key) =>
        findPaper(key, {
          byArxivId: (id) => deps.index.findByArxivId(id),
          byDoi: (doi) => deps.index.findByDoi(doi),
          byTitle: titleIndex(deps.index.titles()),
        }),
      importPaper: (target) => {
        const known = knownPaper(target, { index: deps.index, ingests: deps.ingests })
        if (known !== null) return { kind: 'duplicate', known }
        deps.enqueueResolve(target)
        return { kind: 'queued' }
      },
    }),
  )

  // API 以外の要求は Web クライアントへ回す。パスを持たない要求も index.html を
  // 返し、クライアント側の経路で解決させる。
  if (deps.webRoot !== null) {
    const root = deps.webRoot
    app.use('/assets/*', serveStatic({ root }))
    app.get('*', serveStatic({ root, path: 'index.html' }))
  }

  return app
}
