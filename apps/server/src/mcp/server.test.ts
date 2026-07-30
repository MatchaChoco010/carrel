import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { SearchHit } from '../search/search.ts'
import { buildQuery, createMcpApp, describeHits, describeTags } from './server.ts'

const HIT: SearchHit = {
  slug: 'kerbl2023-3dgs',
  title: '3D Gaussian Splatting',
  path: '4 METHOD > 4.1 Rasterizer',
  excerpt: 'タイルに分けて並べ替える。',
  lang: 'en',
  score: 1,
}

test('検索の結果にファイルの場所を載せ、本文は載せない', () => {
  const text = describeHits([HIT], '/data')

  assert.match(text, /slug: kerbl2023-3dgs/)
  assert.match(text, /\/data\/papers\/kerbl2023-3dgs\/paper\.md/)
  assert.match(text, /\/data\/papers\/kerbl2023-3dgs\/paper\.ja\.md/)
  assert.match(text, /当たった節: 4 METHOD > 4\.1 Rasterizer/)
  assert.match(text, /抜粋: タイルに分けて並べ替える。/)
})

test('当たらなかったときは、次の手を促す', () => {
  assert.match(describeHits([], '/data'), /当たる論文がなかった/)
})

test('タグの一覧に論文の数を添える', () => {
  assert.equal(describeTags([{ tag: '3d', count: 2 }]), '- 3d(2 本)')
  assert.match(describeTags([]), /タグはまだ付いていない/)
})

test('引数を検索の問い合わせへ写す', () => {
  assert.deepEqual(buildQuery({ query: 'sh', author: 'Iwasaki', yearFrom: 2024, tags: ['3d'], limit: 3 }), {
    text: 'sh',
    filter: { author: 'Iwasaki', yearFrom: 2024, tags: ['3d'] },
    limit: 3,
  })
})

test('語句を省くと構造化条件だけの問い合わせになる', () => {
  assert.deepEqual(buildQuery({ venue: 'SIGGRAPH' }), { filter: { venue: 'SIGGRAPH' }, limit: 10 })
})

test('空のタグは条件に入れない', () => {
  assert.deepEqual(buildQuery({ tags: [] }), { filter: {}, limit: 10 })
})

async function rpc(app: ReturnType<typeof createMcpApp>, body: unknown): Promise<Response> {
  return app.request('/', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify(body),
  })
}

function app(hits: SearchHit[] = [HIT]) {
  return createMcpApp({
    dataDir: '/data',
    search: async () => hits,
    tags: () => [{ tag: '3d', count: 2 }],
  })
}

test('公開する道具は検索とタグの一覧の 2 つだけ', async () => {
  const target = app()
  await rpc(target, {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } },
  })

  const response = await rpc(target, { jsonrpc: '2.0', id: 2, method: 'tools/list' })
  const body = await response.text()

  assert.match(body, /search_papers/)
  assert.match(body, /list_tags/)
  assert.equal(/"name":"/.test(body) && body.split('"name":"').length - 1, 2)
})

test('道具を呼ぶと検索の結果が返る', async () => {
  const target = app()
  await rpc(target, {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } },
  })

  const response = await rpc(target, {
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params: { name: 'search_papers', arguments: { query: 'ガウシアン' } },
  })

  assert.match(await response.text(), /kerbl2023-3dgs/)
})
