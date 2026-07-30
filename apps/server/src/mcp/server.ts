import { Hono } from 'hono'
import { paperDir, paperFile } from '../data/layout.ts'
import type { SearchHit, SearchQuery } from '../search/search.ts'

/**
 * 議論中のエージェントへコレクションを開く口。
 *
 * 公開するのは検索とタグの一覧だけで、本文を返す操作と書き込みの操作は持たない(0005)。
 * 本文は検索結果の場所からエージェントが自分で読む。
 */

export type McpDeps = {
  dataDir: () => string
  search: (query: SearchQuery) => Promise<SearchHit[]>
  tags: () => Array<{ tag: string; count: number }>
}

/** この口が話す MCP の版。 */
const PROTOCOL_VERSION = '2025-06-18'

const TOOLS = [
  {
    name: 'search_papers',
    description:
      'コレクションの論文を検索する。語句は日本語でも英語でもよい。本文は返らないので、返ったファイルの場所を自分で読むこと。',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '探したい内容。空にすると構造化条件だけで絞る。' },
        author: { type: 'string', description: '著者名の部分一致。' },
        venue: { type: 'string', description: '学会誌名の部分一致。' },
        yearFrom: { type: 'number', description: '出版年の下限。' },
        yearTo: { type: 'number', description: '出版年の上限。' },
        tags: { type: 'array', items: { type: 'string' }, description: 'すべて満たすタグ。' },
        limit: { type: 'number', description: '返す論文の数。既定は 10。' },
      },
      required: [],
    },
  },
  {
    name: 'list_tags',
    description: 'コレクションで使われているタグと、それぞれの論文の数を返す。',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
] as const

type Request = { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: unknown }

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
}

function buildQuery(args: Record<string, unknown>): SearchQuery {
  const filter: NonNullable<SearchQuery['filter']> = {}
  if (typeof args['author'] === 'string') filter.author = args['author']
  if (typeof args['venue'] === 'string') filter.venue = args['venue']
  if (typeof args['yearFrom'] === 'number') filter.yearFrom = args['yearFrom']
  if (typeof args['yearTo'] === 'number') filter.yearTo = args['yearTo']
  if (Array.isArray(args['tags'])) {
    const tags = args['tags'].filter((t): t is string => typeof t === 'string')
    if (tags.length > 0) filter.tags = tags
  }
  const query: SearchQuery = { filter, limit: typeof args['limit'] === 'number' ? args['limit'] : 10 }
  if (typeof args['query'] === 'string' && args['query'].length > 0) query.text = args['query']
  return query
}

/** 検索結果を、エージェントが本文へ辿れる形にする(0005)。 */
function describeHits(hits: SearchHit[], dataDir: string): string {
  if (hits.length === 0) return '当たる論文がなかった。語句を変えるか、条件を緩めること。'
  return hits
    .map((hit) => {
      const lines = [
        `## ${hit.title}`,
        `- slug: ${hit.slug}`,
        `- ディレクトリ: ${paperDir(dataDir, hit.slug)}`,
        `- 英語の本文: ${paperFile(dataDir, hit.slug, 'body')}`,
        `- 和訳: ${paperFile(dataDir, hit.slug, 'bodyJa')}`,
      ]
      if (hit.path.length > 0) lines.push(`- 当たった節: ${hit.path}`)
      if (hit.excerpt.length > 0) lines.push(`- 抜粋: ${hit.excerpt}`)
      return lines.join('\n')
    })
    .join('\n\n')
}

function text(body: string): { content: Array<{ type: 'text'; text: string }> } {
  return { content: [{ type: 'text', text: body }] }
}

export function createMcpApp(deps: McpDeps): Hono {
  const app = new Hono()

  const call = async (name: string, args: Record<string, unknown>): Promise<unknown> => {
    if (name === 'search_papers') {
      const hits = await deps.search(buildQuery(args))
      return text(describeHits(hits, deps.dataDir()))
    }
    if (name === 'list_tags') {
      const tags = deps.tags()
      const body =
        tags.length === 0
          ? 'タグはまだ付いていない。'
          : tags.map((t) => `- ${t.tag}(${t.count} 本)`).join('\n')
      return text(body)
    }
    return { ...text(`知らない道具: ${name}`), isError: true }
  }

  const handle = async (request: Request): Promise<Record<string, unknown> | null> => {
    const method = typeof request.method === 'string' ? request.method : ''
    const id = request.id

    // 通知には応答を返さない。id を持たないものが通知である。
    if (id === undefined || id === null) return null

    const reply = (result: unknown): Record<string, unknown> => ({ jsonrpc: '2.0', id, result })

    if (method === 'initialize') {
      return reply({
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: 'pct', version: '0.1.0' },
      })
    }
    if (method === 'tools/list') return reply({ tools: TOOLS })
    if (method === 'tools/call') {
      const params = asRecord(request.params)
      const name = typeof params['name'] === 'string' ? params['name'] : ''
      try {
        return reply(await call(name, asRecord(params['arguments'])))
      } catch (error) {
        return reply({ ...text(error instanceof Error ? error.message : String(error)), isError: true })
      }
    }
    if (method === 'ping') return reply({})

    return { jsonrpc: '2.0', id, error: { code: -32601, message: `知らない手続き: ${method}` } }
  }

  app.post('/', async (c) => {
    const body: unknown = await c.req.json().catch(() => null)
    // まとめて送られることがあるので、配列も受ける。
    const requests = Array.isArray(body) ? (body as Request[]) : [asRecord(body) as Request]
    const replies = (await Promise.all(requests.map(handle))).filter((r) => r !== null)
    if (replies.length === 0) return c.body(null, 202)

    const payload = Array.isArray(body) ? replies : (replies[0] as Record<string, unknown>)
    // 相手が事象の流れを受け取れるなら、その形で返す。streamable HTTP の客はこちらを待つ。
    if ((c.req.header('accept') ?? '').includes('text/event-stream')) {
      return new Response(`event: message\ndata: ${JSON.stringify(payload)}\n\n`, {
        headers: {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          connection: 'keep-alive',
        },
      })
    }
    return c.json(payload)
  })

  // セッションを持たないので、開いたままの通知の受け口は要らない。
  app.get('/', (c) => c.body(null, 405))
  app.delete('/', (c) => c.body(null, 405))

  return app
}
