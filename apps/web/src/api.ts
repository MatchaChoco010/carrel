export type RateLimitWindowView = {
  usedPercent: number
  resetsAt: number | null
  windowDurationMins: number | null
  label: string
}

export type RateLimitView = {
  windows: RateLimitWindowView[]
  planType: string | null
  reached: boolean
  reachedType: string | null
  nextResetAt: number | null
}

export type CodexStatus = {
  running: boolean
  rateLimits: RateLimitView | null
}

export type JobState = 'pending' | 'running' | 'waitingForQuota' | 'failed' | 'done'

export type Job = {
  id: number
  kind: string
  target: string
  resource: string
  priority: string
  state: JobState
  attempts: number
  createdAt: number
  updatedAt: number
  lastError: string | null
}

export type JobsResponse = {
  counts: Record<JobState, number>
  jobs: Job[]
}

export type IngestStage =
  | 'resolve'
  | 'fetch'
  | 'convert'
  | 'verify'
  | 'bibliography'
  | 'translate'
  | 'references'
  | 'register'

export type Ingest = {
  slug: string
  sourceUrl: string
  stage: IngestStage
  status: 'inProgress' | 'failed' | 'done'
  startedAt: number
  updatedAt: number
  lastError: string | null
  stages: Array<{ stage: IngestStage; startedAt: number; finishedAt: number | null }>
}

export type ChatRole = 'user' | 'assistant'

export type ChatMessage = {
  role: ChatRole
  at: string
  text: string
}

export type ChatMeta = {
  id: string
  title: string
  papers: string[]
  archived: boolean
  codexThreadId: string | null
  model: string | null
  effort: string | null
}

/** 会話が続きを話せるかどうか。 */
export type ChatState = 'new' | 'resumable' | 'needsReload'

export type ChatSummary = {
  id: string
  path: string
  created: string
  updated: string
  title: string
  summary: string
  archived: boolean
  state: ChatState
}

export type ChatSearchHit = {
  id: string
  path: string
  title: string
  updated: string
  archived: boolean
  /** 当たった発言。語句を指定しなかったときは付かない。 */
  role: 'user' | 'assistant' | null
  at: string | null
  excerpt: string
  score: number
}

export type CodexModel = {
  id: string
  displayName: string
  description: string
  efforts: string[]
  defaultEffort: string | null
  acceptsImages: boolean
  isDefault: boolean
}

export type FeedItem = {
  arxivId: string
  category: string
  title: string
  authors: string[]
  abstract: string | null
  abstractJa: string | null
  publishedAt: number
  addedAt: number
  read: boolean
  /** 取り込み済みならその slug。 */
  slug: string | null
}

/** サーバーが持つ設定。編集して書き戻す(0001)。 */
/** 入力欄へ差し込める定型の文。 */
export type SavedPrompt = {
  name: string
  body: string
}

export type Config = {
  dataDir: string
  server: { host: string; port: number }
  arxiv: { categories: string[]; fetchIntervalMinutes: number; initialLookbackDays: number }
  chat: {
    defaultModel: string
    defaultEffort: string
    instructions: string
    prompts: SavedPrompt[]
    sendOnEnter: boolean
    sendOnCtrlEnter: boolean
  }
  ingest: { model: string; effort: string; serviceTier: string | null }
  embedding: { baseUrl: string; model: string; dimensions: number }
  converter: { python: string; llamaServer: string; llamaLibDir: string; pageScale: number }
}

/** 動いているサーバーの事実。設定として保存した値とは違いうる。 */
export type Health = {
  ok: boolean
  pid: number
  uptimeSeconds: number
  clients: number
  dataDir: string
}

export type ScanResult = {
  papersIndexed: number
  papersRemoved: number
  chatsIndexed: number
  chatsRemoved: number
}

export type IndexStatus = {
  papers: number
  chats: number
  staleEmbeddings: number
  tags: Array<{ tag: string; count: number }>
}

export type SearchHit = {
  slug: string
  title: string
  path: string
  excerpt: string
  lang: 'en' | 'ja'
  score: number
}

export type SearchFilter = {
  title?: string
  author?: string
  venue?: string
  yearFrom?: number
  yearTo?: number
  tags?: string[]
}

export type PaperMeta = {
  slug: string
  title: string
  authors: string[]
  venue: string | null
  year: number | null
  arxivId: string | null
  doi: string | null
  sourceUrl: string
  pdfUrl: string | null
  tags: string[]
  addedAt: string
}

/** 論文の参考文献 1 件。取り込み済みなら importedSlug が入る(0015)。 */
export type Reference = {
  text: string
  title: string
  authors: string[]
  year: number | null
  arxivId: string | null
  doi: string | null
  url: string | null
  kind: 'paper' | 'other'
  importedSlug: string | null
}

export type PaperDetail = {
  meta: PaperMeta
  body: string
  bodyJa: string | null
  abstract: string | null
  abstractJa: string | null
  hasRaw: boolean
  verification: string | null
}

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(path, { headers: { accept: 'application/json' } })
  if (!response.ok) throw new Error(`${path} が ${response.status} を返した`)
  return (await response.json()) as T
}

async function sendJson<T>(method: string, path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method,
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(body),
  })
  const json = (await response.json()) as T & { error?: string }
  if (!response.ok) throw new Error(json.error ?? `${path} が ${response.status} を返した`)
  return json
}

function searchParams(query: string, filter: SearchFilter, limit?: number): string {
  const params = new URLSearchParams()
  if (query.length > 0) params.set('q', query)
  if (limit !== undefined) params.set('limit', String(limit))
  for (const key of ['title', 'author', 'venue'] as const) {
    const value = filter[key]
    if (value !== undefined && value.length > 0) params.set(key, value)
  }
  for (const key of ['yearFrom', 'yearTo'] as const) {
    const value = filter[key]
    if (value !== undefined) params.set(key, String(value))
  }
  if (filter.tags !== undefined && filter.tags.length > 0) params.set('tags', filter.tags.join(','))
  return params.toString()
}

export const api = {
  codexStatus: () => getJson<CodexStatus>('/api/codex/status'),
  jobs: () => getJson<JobsResponse>('/api/jobs'),
  indexStatus: () => getJson<IndexStatus>('/api/index/status'),
  health: () => getJson<Health>('/api/health'),
  config: () => getJson<Config>('/api/config'),
  /** 一部だけを送れる。サーバーが今の設定に重ねてから検証する。 */
  saveConfig: (patch: Partial<Config>) => sendJson<Config>('PUT', '/api/config', patch),
  rebuildIndex: () => sendJson<ScanResult>('POST', '/api/index/rebuild', {}),
  /** 済んだ取り込みの記録を消す。論文は残る(#223)。 */
  clearIngests: () => sendJson<{ cleared: number }>('POST', '/api/ingests/clear', {}),
  /** 失敗した取り込みを捨てる。半端な成果物も消える(#223)。 */
  discardIngest: (slug: string) =>
    sendJson<{ discarded: string; cancelledJobs: number }>(
      'DELETE',
      `/api/ingests/${encodeURIComponent(slug)}`,
      {},
    ),
  ingests: () => getJson<{ ingests: Ingest[] }>('/api/ingests'),
  slugs: () => getJson<{ slugs: string[] }>('/api/papers/slugs'),
  models: () => getJson<{ models: CodexModel[] }>('/api/codex/models'),
  chats: () => getJson<{ chats: ChatSummary[] }>('/api/chats'),
  searchChats: (query: string, filter: { archived?: boolean } = {}) => {
    const params = new URLSearchParams()
    if (query.length > 0) params.set('q', query)
    if (filter.archived !== undefined) params.set('archived', String(filter.archived))
    return getJson<{ hits: ChatSearchHit[] }>(`/api/chats/search?${params.toString()}`)
  },
  chat: (id: string) =>
    getJson<{ meta: ChatMeta; messages: ChatMessage[]; id: string; path: string; running: boolean; state: ChatState }>(
      `/api/chats/one?id=${encodeURIComponent(id)}`,
    ),
  reloadChat: (id: string) => sendJson<{ codexThreadId: string }>('POST', '/api/chats/reload', { id }),
  /** 直前のやりとりを取り消す。落とした発言の本文が返る(0018)。 */
  undoChat: (id: string) => sendJson<{ text: string }>('POST', '/api/chats/undo', { id }),
  branchChat: (id: string, index: number) =>
    sendJson<{ id: string; forked: boolean }>('POST', '/api/chats/branch', { id, index }),
  renameChat: (id: string, title: string) => sendJson<{ title: string }>('PUT', '/api/chats/title', { id, title }),
  setChatArchived: (id: string, archived: boolean) =>
    sendJson<{ archived: boolean }>('PUT', '/api/chats/archived', { id, archived }),
  /** 確認を経てから呼ぶ。押すだけで消える経路は作らない。 */
  deleteChat: (id: string) =>
    sendJson<{ deleted: string; threadDeleted: boolean }>('DELETE', '/api/chats', { id, confirm: true }),
  /** id を省くと、この発言で会話が作られる。 */
  sendChatMessage: async (id: string | null, text: string, model: string, effort: string, images: File[] = []) => {
    // 画像は本文と 1 つの要求で送る(0013)。
    const form = new FormData()
    if (id !== null) form.set('id', id)
    form.set('text', text)
    form.set('model', model)
    form.set('effort', effort)
    for (const image of images) form.append('images', image)
    const response = await fetch('/api/chats/messages', { method: 'POST', body: form })
    const json = (await response.json()) as { id: string; error?: string }
    if (!response.ok) throw new Error(json.error ?? `送信が ${response.status} を返した`)
    return json
  },
  feed: () => getJson<{ items: FeedItem[]; unread: number }>('/api/feed'),
  markFeedRead: (arxivIds: string[]) =>
    sendJson<{ read: number; unread: number }>('POST', '/api/feed/read', { arxivIds }),
  clearJobs: () => sendJson<{ cleared: number; counts: Record<JobState, number> }>('POST', '/api/jobs/clear', {}),
  refreshFeed: () => sendJson<{ queued: boolean }>('POST', '/api/feed/refresh', {}),
  /** limit を渡すと、その件数まで返る。一覧の続きを読むときに増やす(#222)。 */
  search: (query: string, filter: SearchFilter = {}, limit?: number) =>
    getJson<{ hits: SearchHit[] }>(`/api/search?${searchParams(query, filter, limit)}`),
  paper: (slug: string) => getJson<PaperDetail>(`/api/papers/${encodeURIComponent(slug)}`),
  /** references が null なら、参考文献の段階がまだ走っていない。 */
  paperReferences: (slug: string) =>
    getJson<{ references: Reference[] | null }>(`/api/papers/${encodeURIComponent(slug)}/references`),
  setTags: (slug: string, tags: string[]) =>
    sendJson<{ slug: string; tags: string[] }>('PUT', `/api/papers/${encodeURIComponent(slug)}/tags`, { tags }),
  /** `resumed` と `restarted` は、失敗した取り込みを押し直したときに返る(#220)。 */
  importPaper: (url: string) =>
    sendJson<{
      kind?: 'queued' | 'duplicate' | 'resumed' | 'restarted'
      slug?: string
      state?: string
      error?: string
    }>(
      'POST',
      '/api/papers/import',
      { url },
    ),
  /**
   * 手元の PDF を原本として上げる(0021)。
   *
   * 本文をそのまま送る。ファイル名は問い合わせの文字列で渡す。上げ終わると取り込みが積まれる。
   */
  uploadPaper: (file: File) =>
    fetch(`/api/papers/upload?name=${encodeURIComponent(file.name)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/pdf' },
      body: file,
    }).then(async (response) => {
      const body = (await response.json()) as { kind?: 'queued'; name?: string; error?: string }
      if (!response.ok) throw new Error(body.error ?? `上げられなかった (${response.status})`)
      return body
    }),
  deletePaper: (slug: string) =>
    sendJson<{ deleted: string; cancelledJobs: number; runningJobs: number }>(
      'DELETE',
      `/api/papers/${encodeURIComponent(slug)}`,
      {},
    ),
}
