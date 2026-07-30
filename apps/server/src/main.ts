import { serve } from '@hono/node-server'
import { mkdir } from 'node:fs/promises'
import type { Server } from 'node:http'
import { relative } from 'node:path'
import { WebSocketServer } from 'ws'
import { CodexService } from './codex/service.ts'
import { enqueueConvert, registerConvert } from './convert/job.ts'
import { createEmbedder } from './search/embed.ts'
import { search } from './search/search.ts'
import { searchChats } from './search/chat-search.ts'
import { ChatChunkStore } from './search/chat-store.ts'
import { enqueueRegister, registerRegister } from './search/job.ts'
import { ChunkStore } from './search/store.ts'
import { enqueueTranslate, registerTranslate } from './translate/job.ts'
import { enqueueVerify, registerVerify } from './verify/job.ts'
import { loadConfig, type Config } from './config.ts'
import { Collection } from './data/collection.ts'
import { IndexDb } from './db/index-db.ts'
import { StateDb } from './db/state-db.ts'
import { createApp } from './http.ts'
import { JobQueue } from './jobs/queue.ts'
import { JobStore } from './jobs/store.ts'
import { IngestStore } from './ingest/store.ts'
import { enqueueFeedFetch, registerFeed } from './feed/job.ts'
import { FeedStore } from './feed/store.ts'
import { createChat } from './chat/create.ts'
import {
  ChatDigestScheduler,
  enqueueChatDigest,
  enqueueChatIndex,
  registerChatDigest,
  registerChatIndex,
} from './chat/job.ts'
import { ChatSessions } from './chat/session.ts'
import { reloadChat } from './chat/reload.ts'
import { deleteChat, setArchived } from './chat/lifecycle.ts'
import { listModels } from './codex/models.ts'
import { Hub } from './hub.ts'
import { converterScript, indexDbFile, stateDbFile, stateDir, textLayerScript, webRoot } from './paths.ts'

async function main(): Promise<void> {
  let config: Config = await loadConfig()
  await mkdir(stateDir(), { recursive: true })

  const hub = new Hub()
  const index = new IndexDb(indexDbFile())
  const state = new StateDb(stateDbFile())
  const ingests = new IngestStore(state.db)

  // 起動時の走査はキューを作る前に走るので、そのぶんは走査の後にまとめて積む。
  let enqueueChatChunks: (path: string) => void = () => {}

  const collection = new Collection(config.dataDir, index, {
    onPaperChanged: (slug) => hub.broadcast({ type: 'paper.changed', payload: { slug } }),
    onPaperRemoved: (slug) => hub.broadcast({ type: 'paper.removed', payload: { slug } }),
    onChatChanged: (path) => {
      hub.broadcast({ type: 'chat.changed', payload: { path } })
      enqueueChatChunks(path)
    },
    onChatRemoved: (path) => hub.broadcast({ type: 'chat.removed', payload: { path } }),
  },
  () => ingests.incompleteSlugs())

  await collection.ensureDirs()
  const scanned = await collection.scan()
  console.log(
    `索引を同期した: 論文 ${scanned.papersIndexed} 件を読み込み ${scanned.papersRemoved} 件を除去、` +
      `チャット ${scanned.chatsIndexed} 件を読み込み ${scanned.chatsRemoved} 件を除去`,
  )
  collection.startWatching()

  const codex = new CodexService({
    onRateLimits: (view) => {
      hub.broadcast({ type: 'codex.rateLimits', payload: view })
      jobs.onQuotaChanged()
    },
    onApprovalDeclined: (method) => hub.broadcast({ type: 'codex.approvalDeclined', payload: { method } }),
  })

  const jobs = new JobQueue(new JobStore(state.db), {
    quota: {
      blocked: () => codex.rateLimits?.reached === true,
      resumeAt: () => codex.rateLimits?.nextResetAt ?? null,
    },
    onChange: (job) => hub.broadcast({ type: 'job.changed', payload: job }),
  })

  registerConvert(jobs, {
    dataDir: config.dataDir,
    ingests,
    paths: {
      python: config.converter.python,
      script: converterScript(),
      llamaServer: config.converter.llamaServer,
      llamaLibDir: config.converter.llamaLibDir,
    },
    onDone: (slug) => enqueueVerify(jobs, slug),
  })

  registerVerify(jobs, {
    dataDir: config.dataDir,
    ingests,
    codex: codex.client,
    model: config.ingest.model,
    effort: config.ingest.effort,
    serviceTier: config.ingest.serviceTier,
    textLayer: { python: config.converter.python, script: textLayerScript() },
    onDone: (slug) => enqueueTranslate(jobs, slug),
  })

  registerTranslate(jobs, {
    dataDir: config.dataDir,
    ingests,
    codex: codex.client,
    model: config.ingest.model,
    effort: config.ingest.effort,
    serviceTier: config.ingest.serviceTier,
    onDone: (slug) => enqueueRegister(jobs, slug),
  })

  const chunks = new ChunkStore(index.db)
  const embed = createEmbedder({ baseUrl: config.embedding.baseUrl, model: config.embedding.model })
  const embeddingModel = { model: config.embedding.model, dimensions: config.embedding.dimensions }
  if (chunks.needsRebuild(embeddingModel)) {
    console.log('埋め込みのモデルが変わったので、索引の作り直しが要る')
  }
  registerRegister(jobs, {
    dataDir: config.dataDir,
    ingests,
    chunks,
    embed,
    model: embeddingModel,
    indexPaper: (paper) => index.upsertPaper(paper, true),
  })

  const chatChunks = new ChatChunkStore(index.db)
  registerChatIndex(jobs, { dataDir: config.dataDir, chunks: chatChunks, embed })
  enqueueChatChunks = (path) => {
    enqueueChatIndex(jobs, path)
  }

  const feed = new FeedStore(state.db)
  registerFeed(jobs, {
    poll: () => ({
      feed,
      categories: config.arxiv.categories,
      initialLookbackDays: config.arxiv.initialLookbackDays,
    }),
    translate: {
      feed,
      codex: codex.client,
      model: config.ingest.model,
      effort: config.ingest.effort,
      serviceTier: config.ingest.serviceTier,
    },
    onFetched: () => hub.broadcast({ type: 'feed.changed', payload: { unread: feed.unreadCount() } }),
  })

  const digests = new ChatDigestScheduler({ run: (path) => enqueueChatDigest(jobs, path) })
  registerChatDigest(jobs, {
    dataDir: config.dataDir,
    codex: codex.client,
    model: config.ingest.model,
    effort: config.ingest.effort,
    serviceTier: config.ingest.serviceTier,
    reindex: (absolutePath) => collection.reloadChat(absolutePath),
    onDone: (path) => hub.broadcast({ type: 'chat.changed', payload: { path } }),
  })

  const chats = new ChatSessions({
    dataDir: config.dataDir,
    codex: codex.client,
    createChat: async (options) => {
      const created = await createChat(config.dataDir, options)
      return { absolutePath: created.absolutePath }
    },
    knownSlug: (slug) => index.getPaper(slug) !== null,
    defaults: () => ({ model: config.chat.defaultModel, effort: config.chat.defaultEffort }),
    onEvent: (event) => {
      hub.broadcast({ type: event.type, payload: event })
      if (event.type === 'chat.turn.completed') digests.touch(event.path)
    },
    reindex: (absolutePath) => collection.reloadChat(absolutePath),
  })

  const app = createApp({
    search: (query) => search(query, { index, chunks, embed }),
    searchChats: (query) => searchChats(query, { index, chunks: chatChunks, embed }),
    onIngested: (slug) => enqueueConvert(jobs, slug),
    getConfig: () => config,
    setConfig: (next) => {
      config = next
    },
    clientCount: () => hub.size,
    index,
    collection,
    rebuildIndex: async () => {
      index.reset()
      const result = await collection.scan()
      hub.broadcast({ type: 'index.rebuilt', payload: result })
      return result
    },
    codex,
    jobs,
    ingests,
    feed,
    chats,
    models: () => listModels(codex.client),
    reindexChat: (absolutePath) => collection.reloadChat(absolutePath),
    setArchived: (absolutePath, archived) =>
      setArchived(absolutePath, archived, {
        dataDir: config.dataDir,
        codex: codex.client,
        dropFromIndex: (path) => index.deleteChatByPath(path),
        reindex: (absolutePath) => collection.reloadChat(absolutePath),
      }),
    deleteChat: (absolutePath) => {
      digests.cancel(relative(config.dataDir, absolutePath))
      return deleteChat(absolutePath, {
        dataDir: config.dataDir,
        codex: codex.client,
        dropFromIndex: (path) => index.deleteChatByPath(path),
        reindex: (target) => collection.reloadChat(target),
      })
    },
    reloadChat: async (absolutePath) => {
      const threadId = await reloadChat(absolutePath, {
        dataDir: config.dataDir,
        codex: codex.client,
        knownSlug: (slug) => index.getPaper(slug) !== null,
      })
      chats.markResumed(threadId)
      return threadId
    },
    refreshFeed: () => enqueueFeedFetch(jobs),
    webRoot: await webRoot(),
  })

  const server = serve({
    fetch: app.fetch,
    hostname: config.server.host,
    port: config.server.port,
  }) as Server

  const wss = new WebSocketServer({ server, path: '/ws' })
  wss.on('connection', (socket) => hub.add(socket))

  console.log(`listening on http://${config.server.host}:${config.server.port}`)
  console.log(`data dir: ${config.dataDir}`)

  jobs.start()

  // まだ発言が検索の索引に載っていない会話を積む。初回と、pct を止めている間に
  // 増えたぶんがここで入る。
  const indexedChats = chatChunks.indexedChatIds()
  for (const chat of index.listChats()) {
    if (!indexedChats.has(chat.id)) enqueueChatIndex(jobs, chat.path)
  }

  // 起動のたびに取りにいく。止めていた期間の投稿はここでまとめて入る(0004)。
  enqueueFeedFetch(jobs)
  const feedTimer = setInterval(
    () => enqueueFeedFetch(jobs),
    Math.max(1, config.arxiv.fetchIntervalMinutes) * 60 * 1000,
  )
  feedTimer.unref()

  // 会話スレッドが pct の MCP の口を呼ぶため、HTTP を開いた後に起動する。
  try {
    await codex.start()
    const limits = codex.rateLimits
    const windows = limits?.windows.map((w) => `${w.label} ${w.usedPercent}%`).join(' / ') ?? '不明'
    console.log(`codex app-server を起動した (plan=${limits?.planType ?? '不明'}, ${windows})`)
  } catch (error) {
    console.error('codex app-server を起動できなかった', error)
  }

  const shutdown = (signal: string): void => {
    console.log(`${signal} を受けたので終了する`)
    collection.stopWatching()
    clearInterval(feedTimer)
    digests.stop()
    jobs.stop()
    void codex.stop()
    hub.closeAll()
    server.close()
    index.close()
    state.close()
    // close は既存の keep-alive 接続が閉じるのを待つため、期限を切って終了する。
    setTimeout(() => process.exit(0), 500).unref()
  }

  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))
}

await main()
