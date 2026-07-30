import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { writePaper, type PaperMeta } from '../data/paper.ts'
import { IndexDb } from '../db/index-db.ts'
import type { Embedder } from './embed.ts'
import { search } from './search.ts'
import { ChunkStore } from './store.ts'

/** 語が一致するほど近くなる、決まった値を返す埋め込み。 */
const fakeEmbed: Embedder = async (texts) =>
  texts.map((t) => {
    const v = new Float32Array(4)
    v[0] = t.includes('gaussian') || t.includes('ガウシアン') ? 1 : 0
    v[1] = t.includes('radiance') || t.includes('放射輝度') ? 1 : 0
    v[2] = t.includes('mesh') || t.includes('メッシュ') ? 1 : 0
    v[3] = 0.01
    return v
  })

function harness() {
  const root = mkdtempSync(join(tmpdir(), 'pct-search-'))
  const index = new IndexDb(join(root, 'index.sqlite'))
  const chunks = new ChunkStore(index.db)
  return { root, index, chunks, close: () => (index.close(), rmSync(root, { recursive: true, force: true })) }
}

const meta = (slug: string, over: Partial<PaperMeta> = {}): PaperMeta => ({
  slug,
  title: 'A Paper',
  authors: ['Bernhard Kerbl'],
  venue: 'ACM TOG',
  year: 2023,
  arxivId: null,
  sourceUrl: `https://example.com/${slug}`,
  pdfUrl: null,
  tags: [],
  addedAt: '2026-07-29T10:00:00+09:00' as PaperMeta['addedAt'],
  ...over,
})

async function addPaper(
  h: ReturnType<typeof harness>,
  m: PaperMeta,
  chunks: { lang: 'en' | 'ja'; text: string; path?: string }[],
): Promise<void> {
  await writePaper(h.root, m, 'body')
  h.index.upsertPaper({ meta: m, body: 'body', mtimeMs: 0, bodyHash: 'hash' }, true)
  const vectors = await fakeEmbed(chunks.map((c) => c.text))
  h.chunks.replace(
    m.slug,
    chunks.map((c, i) => ({
      lang: c.lang,
      position: i,
      path: c.path ?? '節',
      text: c.text,
      vector: vectors[i] ?? null,
    })),
  )
}

test('日本語の問い合わせで、語が一致しない英語の論文が上位に来る', async () => {
  const h = harness()
  try {
    await addPaper(h, meta('kerbl2023-3dgs', { title: '3D Gaussian Splatting' }), [
      { lang: 'en', text: 'we represent the scene with 3d gaussian primitives' },
    ])
    await addPaper(h, meta('other2020-mesh', { title: 'Mesh Reconstruction' }), [
      { lang: 'en', text: 'we reconstruct a triangle mesh from point clouds' },
    ])

    const hits = await search({ text: 'ガウシアン' }, { index: h.index, chunks: h.chunks, embed: fakeEmbed })
    assert.equal(hits[0]?.slug, 'kerbl2023-3dgs')
  } finally {
    h.close()
  }
})

test('和訳のチャンクも当たる', async () => {
  const h = harness()
  try {
    await addPaper(h, meta('kerbl2023-3dgs'), [
      { lang: 'en', text: 'gaussian primitives' },
      { lang: 'ja', text: 'ガウシアンのプリミティブ', path: '3 手法' },
    ])
    const hits = await search({ text: 'ガウシアン' }, { index: h.index, chunks: h.chunks, embed: fakeEmbed })
    assert.equal(hits.length, 1)
    assert.equal(hits[0]?.slug, 'kerbl2023-3dgs')
  } finally {
    h.close()
  }
})

test('論文ごとに 1 件で代表させる', async () => {
  const h = harness()
  try {
    await addPaper(h, meta('kerbl2023-3dgs'), [
      { lang: 'en', text: 'gaussian one', path: '1 序論' },
      { lang: 'en', text: 'gaussian two', path: '3 手法' },
      { lang: 'ja', text: 'ガウシアン 3', path: '3 手法' },
    ])
    const hits = await search({ text: 'gaussian' }, { index: h.index, chunks: h.chunks, embed: fakeEmbed })
    assert.equal(hits.length, 1)
    assert.ok((hits[0]?.path ?? '').length > 0)
  } finally {
    h.close()
  }
})

test('タイトルの部分一致で絞り込める', async () => {
  const h = harness()
  try {
    await addPaper(h, meta('a2023-x', { title: '3D Gaussian Splatting' }), [{ lang: 'en', text: 'gaussian' }])
    await addPaper(h, meta('b2020-y', { title: 'Mesh Reconstruction' }), [{ lang: 'en', text: 'gaussian' }])
    const hits = await search(
      { text: 'gaussian', filter: { title: 'Splatting' } },
      { index: h.index, chunks: h.chunks, embed: fakeEmbed },
    )
    assert.deepEqual(
      hits.map((x) => x.slug),
      ['a2023-x'],
    )
  } finally {
    h.close()
  }
})

test('著者と学会名と出版年で絞り込める', async () => {
  const h = harness()
  try {
    await addPaper(h, meta('a2023-x'), [{ lang: 'en', text: 'gaussian' }])
    await addPaper(h, meta('b2020-y', { authors: ['Ben Mildenhall'], venue: 'ECCV', year: 2020 }), [
      { lang: 'en', text: 'gaussian' },
    ])
    const deps = { index: h.index, chunks: h.chunks, embed: fakeEmbed }
    assert.deepEqual((await search({ text: 'gaussian', filter: { author: 'Kerbl' } }, deps)).map((x) => x.slug), [
      'a2023-x',
    ])
    assert.deepEqual((await search({ text: 'gaussian', filter: { venue: 'ECCV' } }, deps)).map((x) => x.slug), [
      'b2020-y',
    ])
    assert.deepEqual((await search({ text: 'gaussian', filter: { yearFrom: 2023 } }, deps)).map((x) => x.slug), [
      'a2023-x',
    ])
  } finally {
    h.close()
  }
})

test('タグで絞り込める', async () => {
  const h = harness()
  try {
    await addPaper(h, meta('a2023-x', { tags: ['読了'] }), [{ lang: 'en', text: 'gaussian' }])
    await addPaper(h, meta('b2020-y'), [{ lang: 'en', text: 'gaussian' }])
    const hits = await search(
      { text: 'gaussian', filter: { tags: ['読了'] } },
      { index: h.index, chunks: h.chunks, embed: fakeEmbed },
    )
    assert.deepEqual(
      hits.map((x) => x.slug),
      ['a2023-x'],
    )
  } finally {
    h.close()
  }
})

test('条件に当たる論文が無ければ結果も空', async () => {
  const h = harness()
  try {
    await addPaper(h, meta('a2023-x'), [{ lang: 'en', text: 'gaussian' }])
    const hits = await search(
      { text: 'gaussian', filter: { venue: '存在しない学会' } },
      { index: h.index, chunks: h.chunks, embed: fakeEmbed },
    )
    assert.deepEqual(hits, [])
  } finally {
    h.close()
  }
})

test('語句が無ければ構造化条件だけで並べる', async () => {
  const h = harness()
  try {
    await addPaper(h, meta('a2023-x', { year: 2023 }), [{ lang: 'en', text: 'gaussian' }])
    await addPaper(h, meta('b2020-y', { year: 2020 }), [{ lang: 'en', text: 'mesh' }])
    const hits = await search({ filter: { yearFrom: 2023 } }, { index: h.index, chunks: h.chunks, embed: fakeEmbed })
    assert.deepEqual(
      hits.map((x) => x.slug),
      ['a2023-x'],
    )
  } finally {
    h.close()
  }
})

test('検索の記号を含む問い合わせでも落ちない', async () => {
  const h = harness()
  try {
    await addPaper(h, meta('a2023-x'), [{ lang: 'en', text: 'gaussian splatting' }])
    const hits = await search(
      { text: 'gaussian AND "splatting" OR (x)' },
      { index: h.index, chunks: h.chunks, embed: fakeEmbed },
    )
    assert.ok(Array.isArray(hits))
  } finally {
    h.close()
  }
})

test('見出し経路と抜粋を返す', async () => {
  const h = harness()
  try {
    await addPaper(h, meta('a2023-x'), [{ lang: 'en', text: 'gaussian primitives', path: '3 手法 > 3.1 最適化' }])
    const hits = await search({ text: 'gaussian' }, { index: h.index, chunks: h.chunks, embed: fakeEmbed })
    assert.equal(hits[0]?.path, '3 手法 > 3.1 最適化')
    assert.match(hits[0]?.excerpt ?? '', /gaussian/)
  } finally {
    h.close()
  }
})
