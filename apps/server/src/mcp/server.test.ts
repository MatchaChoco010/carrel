import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { SearchHit } from '../search/search.ts'
import { createMcpApp, type McpDeps } from './server.ts'

const HIT: SearchHit = {
  slug: 'kerbl2023-3dgs',
  title: '3D Gaussian Splatting',
  path: '4 METHOD > 4.1 Rasterizer',
  excerpt: 'タイルに分けて並べ替える。',
  lang: 'en',
  score: 1,
}

function harness(over: Partial<McpDeps> = {}) {
  const calls: unknown[] = []
  const app = createMcpApp({
    dataDir: () => '/data',
    search: async (query) => {
      calls.push(query)
      return [HIT]
    },
    tags: () => [{ tag: '3d', count: 2 }],
    ...over,
  })
  const send = async (body: unknown, accept = 'application/json'): Promise<Response> =>
    app.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept },
      body: JSON.stringify(body),
    })
  return { send, calls }
}

const rpc = (method: string, params?: unknown): Record<string, unknown> => ({
  jsonrpc: '2.0',
  id: 1,
  method,
  ...(params === undefined ? {} : { params }),
})

test('initialize に版と能力を返す', async () => {
  const h = harness()

  const body = (await (await h.send(rpc('initialize'))).json()) as Record<string, never>

  assert.equal((body['result'] as Record<string, unknown>)['protocolVersion'], '2025-06-18')
})

test('公開する道具は検索とタグの一覧の 2 つだけ', async () => {
  const h = harness()

  const body = (await (await h.send(rpc('tools/list'))).json()) as {
    result: { tools: Array<{ name: string }> }
  }

  assert.deepEqual(
    body.result.tools.map((t) => t.name),
    ['search_papers', 'list_tags'],
  )
})

test('検索の結果にファイルの場所を載せ、本文は載せない', async () => {
  const h = harness()

  const body = (await (
    await h.send(rpc('tools/call', { name: 'search_papers', arguments: { query: 'ガウシアン' } }))
  ).json()) as { result: { content: Array<{ text: string }> } }

  const text = body.result.content[0]?.text ?? ''
  assert.match(text, /slug: kerbl2023-3dgs/)
  assert.match(text, /\/data\/papers\/kerbl2023-3dgs\/paper\.md/)
  assert.match(text, /当たった節: 4 METHOD > 4\.1 Rasterizer/)
})

test('構造化条件をそのまま検索へ渡す', async () => {
  const h = harness()

  await h.send(
    rpc('tools/call', {
      name: 'search_papers',
      arguments: { query: 'sh', author: 'Iwasaki', yearFrom: 2024, tags: ['3d'], limit: 3 },
    }),
  )

  assert.deepEqual(h.calls[0], {
    text: 'sh',
    filter: { author: 'Iwasaki', yearFrom: 2024, tags: ['3d'] },
    limit: 3,
  })
})

test('当たらなかったときは、次の手を促す', async () => {
  const h = harness({ search: async () => [] })

  const body = (await (
    await h.send(rpc('tools/call', { name: 'search_papers', arguments: { query: 'x' } }))
  ).json()) as { result: { content: Array<{ text: string }> } }

  assert.match(body.result.content[0]?.text ?? '', /当たる論文がなかった/)
})

test('タグの一覧に論文の数を添える', async () => {
  const h = harness()

  const body = (await (await h.send(rpc('tools/call', { name: 'list_tags', arguments: {} }))).json()) as {
    result: { content: Array<{ text: string }> }
  }

  assert.match(body.result.content[0]?.text ?? '', /3d\(2 本\)/)
})

test('知らない道具は失敗として返す', async () => {
  const h = harness()

  const body = (await (await h.send(rpc('tools/call', { name: 'write_paper', arguments: {} }))).json()) as {
    result: { isError: boolean }
  }

  assert.equal(body.result.isError, true)
})

test('知らない手続きにはエラーを返す', async () => {
  const h = harness()

  const body = (await (await h.send(rpc('resources/list'))).json()) as { error: { code: number } }

  assert.equal(body.error.code, -32601)
})

test('通知には応答を返さない', async () => {
  const h = harness()

  const response = await h.send({ jsonrpc: '2.0', method: 'notifications/initialized' })

  assert.equal(response.status, 202)
})

test('事象の流れを受け取れる相手には、その形で返す', async () => {
  const h = harness()

  const response = await h.send(rpc('tools/list'), 'application/json, text/event-stream')
  const body = await response.text()

  assert.match(response.headers.get('content-type') ?? '', /text\/event-stream/)
  assert.match(body, /^event: message\ndata: \{/)
})
