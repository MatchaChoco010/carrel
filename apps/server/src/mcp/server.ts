import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { Hono } from 'hono'
import { z } from 'zod'
import { paperDir, paperFile } from '../data/layout.ts'
import type { SearchHit, SearchQuery } from '../search/search.ts'

/**
 * 議論中のエージェントへコレクションを開く口。
 *
 * 公開するのは検索とタグの一覧だけで、本文を返す操作と書き込みの操作は持たない(0005)。
 * 本文は検索結果の場所からエージェントが自分で読む。
 *
 * 手続きそのものは MCP の公式の実装に任せる。仕様は改訂が続いており、セッション・
 * 事象の再送・`Origin` の検証を自分で追い続ける理由がない。
 */

export type McpDeps = {
  dataDir: string
  search: (query: SearchQuery) => Promise<SearchHit[]>
  tags: () => Array<{ tag: string; count: number }>
}

const SEARCH_INPUT = {
  query: z.string().optional().describe('探したい内容。日本語でも英語でもよい。省くと構造化条件だけで絞る。'),
  author: z.string().optional().describe('著者名の部分一致。'),
  venue: z.string().optional().describe('学会誌名の部分一致。'),
  yearFrom: z.number().optional().describe('出版年の下限。'),
  yearTo: z.number().optional().describe('出版年の上限。'),
  tags: z.array(z.string()).optional().describe('すべて満たすタグ。'),
  limit: z.number().optional().describe('返す論文の数。既定は 10。'),
}

type SearchArgs = {
  query?: string
  author?: string
  venue?: string
  yearFrom?: number
  yearTo?: number
  tags?: string[]
  limit?: number
}

export function buildQuery(args: SearchArgs): SearchQuery {
  const filter: NonNullable<SearchQuery['filter']> = {}
  if (args.author !== undefined) filter.author = args.author
  if (args.venue !== undefined) filter.venue = args.venue
  if (args.yearFrom !== undefined) filter.yearFrom = args.yearFrom
  if (args.yearTo !== undefined) filter.yearTo = args.yearTo
  if (args.tags !== undefined && args.tags.length > 0) filter.tags = args.tags

  const query: SearchQuery = { filter, limit: args.limit ?? 10 }
  if (args.query !== undefined && args.query.length > 0) query.text = args.query
  return query
}

/** 検索の結果を、エージェントが本文へ辿れる形にする(0005)。 */
export function describeHits(hits: SearchHit[], dataDir: string): string {
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

export function describeTags(tags: Array<{ tag: string; count: number }>): string {
  if (tags.length === 0) return 'タグはまだ付いていない。'
  return tags.map((t) => `- ${t.tag}(${t.count} 本)`).join('\n')
}

function text(body: string): { content: Array<{ type: 'text'; text: string }> } {
  return { content: [{ type: 'text' as const, text: body }] }
}

export function createMcpServer(deps: McpDeps): McpServer {
  const server = new McpServer({ name: 'pct', version: '0.1.0' })

  server.registerTool(
    'search_papers',
    {
      title: '論文を検索する',
      description:
        'コレクションの論文を検索する。語句は日本語でも英語でもよい。本文は返らないので、返ったファイルの場所を自分で読むこと。',
      inputSchema: SEARCH_INPUT,
    },
    async (args) => text(describeHits(await deps.search(buildQuery(args as SearchArgs)), deps.dataDir)),
  )

  server.registerTool(
    'list_tags',
    {
      title: 'タグの一覧を得る',
      description: 'コレクションで使われているタグと、それぞれの論文の数を返す。',
      inputSchema: {},
    },
    async () => text(describeTags(deps.tags())),
  )

  return server
}

export function createMcpApp(deps: McpDeps): Hono {
  const app = new Hono()

  // セッションを持たず、要求ごとに立てる。道具は索引を引くだけで、要求をまたいで
  // 持ち回す状態が無い。この形の transport は使い回せない。
  app.all('/', async (c) => {
    const transport = new WebStandardStreamableHTTPServerTransport({})
    await createMcpServer(deps).connect(transport)
    return transport.handleRequest(c.req.raw)
  })

  return app
}
