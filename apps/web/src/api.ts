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

export type IngestStage = 'resolve' | 'fetch' | 'convert' | 'verify' | 'translate' | 'register'

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
  sourceUrl: string
  pdfUrl: string | null
  tags: string[]
  addedAt: string
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

function searchParams(query: string, filter: SearchFilter): string {
  const params = new URLSearchParams()
  if (query.length > 0) params.set('q', query)
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
  ingests: () => getJson<{ ingests: Ingest[] }>('/api/ingests'),
  slugs: () => getJson<{ slugs: string[] }>('/api/papers/slugs'),
  models: () => getJson<{ models: CodexModel[] }>('/api/codex/models'),
  chats: () => getJson<{ chats: ChatSummary[] }>('/api/chats'),
  chat: (path: string) =>
    getJson<{ meta: ChatMeta; messages: ChatMessage[]; path: string; running: boolean; state: ChatState }>(
      `/api/chats/one?path=${encodeURIComponent(path)}`,
    ),
  reloadChat: (path: string) => sendJson<{ codexThreadId: string }>('POST', '/api/chats/reload', { path }),
  renameChat: (path: string, title: string) => sendJson<{ title: string }>('PUT', '/api/chats/title', { path, title }),
  /** path を省くと、この発言で会話が作られる。 */
  sendChatMessage: (path: string | null, text: string, model: string, effort: string) =>
    sendJson<{ path: string }>('POST', '/api/chats/messages', { path, text, model, effort }),
  feed: () => getJson<{ items: FeedItem[]; unread: number }>('/api/feed'),
  markFeedRead: (arxivIds: string[]) =>
    sendJson<{ read: number; unread: number }>('POST', '/api/feed/read', { arxivIds }),
  refreshFeed: () => sendJson<{ queued: boolean }>('POST', '/api/feed/refresh', {}),
  search: (query: string, filter: SearchFilter = {}) =>
    getJson<{ hits: SearchHit[] }>(`/api/search?${searchParams(query, filter)}`),
  paper: (slug: string) => getJson<PaperDetail>(`/api/papers/${encodeURIComponent(slug)}`),
  paperRaw: (slug: string) => getJson<{ raw: string }>(`/api/papers/${encodeURIComponent(slug)}/raw`),
  setTags: (slug: string, tags: string[]) =>
    sendJson<{ slug: string; tags: string[] }>('PUT', `/api/papers/${encodeURIComponent(slug)}/tags`, { tags }),
  importPaper: (url: string) => sendJson<{ slug?: string; error?: string }>('POST', '/api/papers/import', { url }),
  deletePaper: (slug: string) =>
    sendJson<{ deleted: string; cancelledJobs: number; runningJobs: number }>(
      'DELETE',
      `/api/papers/${encodeURIComponent(slug)}`,
      {},
    ),
}
