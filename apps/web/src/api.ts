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

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(path, { headers: { accept: 'application/json' } })
  if (!response.ok) throw new Error(`${path} が ${response.status} を返した`)
  return (await response.json()) as T
}

export const api = {
  codexStatus: () => getJson<CodexStatus>('/api/codex/status'),
  jobs: () => getJson<JobsResponse>('/api/jobs'),
  indexStatus: () => getJson<IndexStatus>('/api/index/status'),
}
