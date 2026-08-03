import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { Hono } from 'hono'
import { z } from 'zod'
import { paperDir, paperFile } from '../data/layout.ts'
import type { KnownPaper } from '../ingest/known.ts'
import type { PaperKey } from '../search/find-paper.ts'
import type { SearchHit, SearchQuery } from '../search/search.ts'

/**
 * 議論中のエージェントへコレクションを開く口。
 *
 * 本文を返す操作は持たない(0005)。本文は検索結果の場所からエージェントが自分で読む。
 * 状態を変える操作は取り込みだけである。取り消せる操作だけをエージェントに渡す、が
 * この口の線引きで、削除・整理・設定の変更は出さない(0016)。
 *
 * 手続きそのものは MCP の公式の実装に任せる。仕様は改訂が続いており、セッション・
 * 事象の再送・`Origin` の検証を自分で追い続ける理由がない。
 */

export type McpDeps = {
  dataDir: string
  search: (query: SearchQuery) => Promise<SearchHit[]>
  tags: () => Array<{ tag: string; count: number }>
  /** 題名・arXiv の識別子・DOI で 1 本を引く(0016)。 */
  findPaper: (key: PaperKey) => { slug: string; title: string } | null
  /** 取り込みを積む。積んだところで返り、完了は待たない(0016)。 */
  importPaper: (target: string) => { kind: 'queued' } | { kind: 'duplicate'; known: KnownPaper }
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

const FIND_INPUT = {
  title: z.string().optional().describe('論文の題名。書き方の揺れは無視して当てる。'),
  year: z.number().optional().describe('出版年。同じ題名の別の論文と取り違えないために添える。'),
  arxivId: z.string().optional().describe('arXiv の識別子。URL でもよい。'),
  doi: z.string().optional().describe('DOI。'),
}

const IMPORT_INPUT = {
  target: z.string().describe('論文の URL か題名。1 回の呼びで 1 本だけ積む。'),
}

export function describeFound(found: { slug: string; title: string } | null): string {
  if (found === null) return 'コレクションにこの論文は無い。取り込むかどうかはユーザーが決めるので、勝手に積まない。'
  return [`コレクションにある。`, `- slug: ${found.slug}`, `- 題: ${found.title}`].join('\n')
}

export function describeImport(result: ReturnType<McpDeps['importPaper']>): string {
  if (result.kind === 'queued') {
    return [
      '取り込みを積んだ。解決と取得はこの後の仕事として進むので、結果はここでは分からない。',
      'ユーザーの画面には仕事として現れ、そこで取り消せる。',
    ].join('\n')
  }
  const known = result.known
  if (known.state === 'imported') return `既にコレクションにある: ${known.slug}`
  if (known.state === 'inProgress') return `この論文は取り込みの途中である: ${known.slug}`
  return `この論文は前の取り込みが失敗している: ${known.slug}。ユーザーが画面から積み直せる。`
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
    'find_paper',
    {
      title: '論文がコレクションにあるかを引く',
      description:
        '題名・arXiv の識別子・DOI のいずれかで、その論文がコレクションにあるかを確かめる。当たれば slug を返す。関連する論文を探すのではなく、その 1 本があるかを確かめる道具である。',
      inputSchema: FIND_INPUT,
    },
    async (args) => text(describeFound(deps.findPaper(args as PaperKey))),
  )

  server.registerTool(
    'import_paper',
    {
      title: '論文の取り込みを積む',
      description:
        '論文の取り込みを積む。引数は URL か題名で、1 回の呼びで 1 本だけ積む。積んだところで返り、取り込みの完了は待たない。' +
        'ユーザーに取り込むよう明示的に言われたときだけ呼ぶこと。探すよう言われただけなら、調べた結果を会話で示すだけにして、この道具を呼ばない。',
      inputSchema: IMPORT_INPUT,
    },
    async (args) => text(describeImport(deps.importPaper((args as { target: string }).target))),
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
