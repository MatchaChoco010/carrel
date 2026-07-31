import { serve } from '@hono/node-server'
import { mkdir } from 'node:fs/promises'
import type { Server } from 'node:http'
import { join, relative } from 'node:path'
import { WebSocketServer } from 'ws'
import { CodexService } from './codex/service.ts'
import { enqueueConvert, registerConvert } from './convert/job.ts'
import { createEmbedder } from './search/embed.ts'
import { search } from './search/search.ts'
import { searchChats } from './search/chat-search.ts'
import { ChatChunkStore } from './search/chat-store.ts'
import { enqueueEmbed, enqueueRegister, registerEmbed, registerRegister } from './search/job.ts'
import { ChunkStore } from './search/store.ts'
import { enqueueTranslate, registerTranslate } from './translate/job.ts'
import { enqueueVerify, registerVerify } from './verify/job.ts'
import { loadConfig, type Config } from './config.ts'
import { writeAgentsMd } from './data/agents-md.ts'
import { Collection } from './data/collection.ts'
import type { Paper } from './data/paper.ts'
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
import { branchChat } from './chat/branch.ts'
import { InstructionStore } from './chat/instruction-store.ts'
import { reloadChat } from './chat/reload.ts'
import { deleteChat, setArchived } from './chat/lifecycle.ts'
import { listModels } from './codex/models.ts'
import { Hub } from './hub.ts'
import { converterScript, indexDbFile, stateDbFile, stateDir, textLayerScript, webRoot } from './paths.ts'

async function main(): Promise<void> {
  let config: Config = await loadConfig()
  // 置き場所は起動時に固定する。索引・走査・ジョブがこの場所に紐づくので、途中で
  // 変えると取り込みと変換が別の場所を見る。保存した値は次の起動から効く。
  const dataDir = config.dataDir
  await mkdir(stateDir(), { recursive: true })

  const hub = new Hub()
  const index = new IndexDb(indexDbFile())
  const state = new StateDb(stateDbFile())
  const ingests = new IngestStore(state.db)
  const inForce = new InstructionStore(state.db)

  // 起動時の走査はキューを作る前に走るので、そのぶんは走査の後にまとめて積む。
  let enqueueChatChunks: (path: string) => void = () => {}

  const collection = new Collection(dataDir, index, {
    onPaperChanged: (slug) => hub.broadcast({ type: 'paper.changed', payload: { slug } }),
    onPaperRemoved: (slug) => hub.broadcast({ type: 'paper.removed', payload: { slug } }),
    onChatChanged: (chat) => {
      hub.broadcast({ type: 'chat.changed', payload: chat })
      enqueueChatChunks(chat.path)
    },
    onChatRemoved: (chat) => hub.broadcast({ type: 'chat.removed', payload: chat }),
  },
  () => ingests.incompleteSlugs())

  await collection.ensureDirs()
  await writeAgentsMd(dataDir)
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
    onRateLimitsUnavailable: (error) => console.warn('codex の残枠を読めなかった', error),
  })

  const jobs = new JobQueue(new JobStore(state.db), {
    quota: {
      blocked: () => codex.rateLimits?.reached === true,
      resumeAt: () => codex.rateLimits?.nextResetAt ?? null,
    },
    onChange: (job) => hub.broadcast({ type: 'job.changed', payload: job }),
  })

  registerConvert(jobs, {
    dataDir,
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
    dataDir,
    ingests,
    codex: codex.client,
    model: config.ingest.model,
    effort: config.ingest.effort,
    serviceTier: config.ingest.serviceTier,
    textLayer: { python: config.converter.python, script: textLayerScript() },
    onDone: (slug) => enqueueTranslate(jobs, slug),
  })

  registerTranslate(jobs, {
    dataDir,
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
  const registerDeps = {
    dataDir,
    chunks,
    embed,
    model: embeddingModel,
    indexPaper: (paper: Paper) => index.upsertPaper(paper, true),
    markEmbedded: (slug: string) => index.markEmbeddingFresh(slug),
  }
  registerRegister(jobs, { ...registerDeps, ingests })
  registerEmbed(jobs, registerDeps)

  /** 埋め込みを持たない論文を積み直す。索引を作り直した後と、起動のときに呼ぶ。 */
  const backfillEmbeddings = (): number => {
    const slugs = index.staleEmbeddingSlugs()
    for (const slug of slugs) enqueueEmbed(jobs, slug)
    return slugs.length
  }

  const chatChunks = new ChatChunkStore(index.db)
  registerChatIndex(jobs, { dataDir, chunks: chatChunks, embed })
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

  // Codex は同じマシンから繋ぐので、待ち受けの設定に関係なくループバックで渡す(0007)。
  const mcpUrl = `http://127.0.0.1:${config.server.port}/mcp`

  const digests = new ChatDigestScheduler({ run: (path) => enqueueChatDigest(jobs, path) })
  registerChatDigest(jobs, {
    dataDir,
    codex: codex.client,
    model: config.ingest.model,
    effort: config.ingest.effort,
    serviceTier: config.ingest.serviceTier,
    reindex: (absolutePath) => collection.reloadChat(absolutePath),
    chatFile: (id) => {
      const path = index.chatPathById(id)
      return path === null ? null : join(dataDir, path)
    },
    onDone: (id) => hub.broadcast({ type: 'chat.changed', payload: { id } }),
  })

  const chats = new ChatSessions({
    dataDir,
    codex: codex.client,
    createChat: async (options) => {
      const created = await createChat(dataDir, options)
      return { absolutePath: created.absolutePath, id: created.chat.meta.id }
    },
    knownSlug: (slug) => index.getPaper(slug) !== null,
    mcpUrl,
    defaults: () => ({ model: config.chat.defaultModel, effort: config.chat.defaultEffort }),
    instructions: () => config.chat.instructions,
    inForce,
    onEvent: (event) => {
      hub.broadcast({ type: event.type, payload: event })
      if (event.type === 'chat.turn.completed') digests.touch(event.id)
    },
    reindex: (absolutePath) => collection.reloadChat(absolutePath),
  })

  const app = createApp({
    search: (query) => search(query, { index, chunks, embed }),
    searchChats: (query) => searchChats(query, { index, chunks: chatChunks, embed }),
    onIngested: (slug) => enqueueConvert(jobs, slug),
    dataDir,
    getConfig: () => config,
    setConfig: (next) => {
      config = next
      // 開いている画面が既定を追えるようにする。まだ始めていない会話の選び直しに要る。
      hub.broadcast({ type: 'config.changed', payload: { chat: next.chat } })
    },
    clientCount: () => hub.size,
    index,
    collection,
    rebuildIndex: async () => {
      index.reset()
      const result = await collection.scan()
      // 走査は markdown を読み直すだけなので、埋め込みはここで積み直す。
      backfillEmbeddings()
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
        dataDir,
        codex: codex.client,
        dropFromIndex: (path) => index.deleteChatByPath(path),
        reindex: (absolutePath) => collection.reloadChat(absolutePath),
      }),
    deleteChat: (absolutePath) => {
      digests.cancel(relative(dataDir, absolutePath))
      return deleteChat(absolutePath, {
        dataDir,
        codex: codex.client,
        dropFromIndex: (path) => index.deleteChatByPath(path),
        reindex: (target) => collection.reloadChat(target),
      })
    },
    branchChat: (absolutePath, selected) =>
      branchChat(absolutePath, selected, {
        dataDir,
        codex: codex.client,
        knownSlug: (slug) => index.getPaper(slug) !== null,
        isResumable: async (threadId) => (await chats.stateOfThread(threadId)) === 'resumable',
        markResumed: (threadId) => chats.markResumed(threadId),
        defaults: () => ({ model: config.chat.defaultModel, effort: config.chat.defaultEffort }),
        instructions: () => config.chat.instructions,
        inForce,
        mcpUrl,
        reindex: (target) => collection.reloadChat(target),
      }),
    reloadChat: async (absolutePath) => {
      const threadId = await reloadChat(absolutePath, {
        dataDir,
        codex: codex.client,
        knownSlug: (slug) => index.getPaper(slug) !== null,
        mcpUrl,
        instructions: () => config.chat.instructions,
        inForce,
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
  console.log(`data dir: ${dataDir}`)

  jobs.start()

  const stale = backfillEmbeddings()
  if (stale > 0) console.log(`埋め込みを持たない論文 ${stale} 件を積んだ`)

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
