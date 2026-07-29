import { serve } from '@hono/node-server'
import { mkdir } from 'node:fs/promises'
import type { Server } from 'node:http'
import { WebSocketServer } from 'ws'
import { CodexService } from './codex/service.ts'
import { enqueueConvert, registerConvert } from './convert/job.ts'
import { createEmbedder } from './search/embed.ts'
import { search } from './search/search.ts'
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
import { Hub } from './hub.ts'
import { converterScript, indexDbFile, stateDbFile, stateDir, textLayerScript, webRoot } from './paths.ts'

async function main(): Promise<void> {
  let config: Config = await loadConfig()
  await mkdir(stateDir(), { recursive: true })

  const hub = new Hub()
  const index = new IndexDb(indexDbFile())
  const state = new StateDb(stateDbFile())
  const ingests = new IngestStore(state.db)

  const collection = new Collection(config.dataDir, index, {
    onPaperChanged: (slug) => hub.broadcast({ type: 'paper.changed', payload: { slug } }),
    onPaperRemoved: (slug) => hub.broadcast({ type: 'paper.removed', payload: { slug } }),
    onChatChanged: (path) => hub.broadcast({ type: 'chat.changed', payload: { path } }),
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
    textLayer: { python: config.converter.python, script: textLayerScript() },
    onDone: (slug) => enqueueTranslate(jobs, slug),
  })

  registerTranslate(jobs, {
    dataDir: config.dataDir,
    ingests,
    codex: codex.client,
    model: config.ingest.model,
    effort: config.ingest.effort,
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

  const app = createApp({
    search: (query) => search(query, { index, chunks, embed }),
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
