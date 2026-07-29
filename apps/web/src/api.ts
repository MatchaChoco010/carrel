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
  search: (query: string, filter: SearchFilter = {}) =>
    getJson<{ hits: SearchHit[] }>(`/api/search?${searchParams(query, filter)}`),
  paper: (slug: string) => getJson<PaperDetail>(`/api/papers/${encodeURIComponent(slug)}`),
  paperRaw: (slug: string) => getJson<{ raw: string }>(`/api/papers/${encodeURIComponent(slug)}/raw`),
  setTags: (slug: string, tags: string[]) =>
    sendJson<{ slug: string; tags: string[] }>('PUT', `/api/papers/${encodeURIComponent(slug)}/tags`, { tags }),
  importPaper: (url: string) => sendJson<{ slug?: string; error?: string }>('POST', '/api/papers/import', { url }),
  deletePaper: (slug: string) => sendJson<{ deleted: string }>('DELETE', `/api/papers/${encodeURIComponent(slug)}`, {}),
}
