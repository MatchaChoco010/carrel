import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { writePaper, type PaperMeta } from '../data/paper.ts'
import { IndexDb } from '../db/index-db.ts'
import type { Embedder } from './embed.ts'
import { registerPaper } from './register.ts'
import { ChunkStore } from './store.ts'

const embed: Embedder = async (texts) => texts.map(() => Float32Array.from([1, 0, 0, 0]))

const meta = (slug: string): PaperMeta => ({
  slug,
  title: 'A Paper',
  authors: ['Bernhard Kerbl'],
  venue: 'ACM TOG',
  year: 2023,
  arxivId: null,
  sourceUrl: `https://example.com/${slug}`,
  pdfUrl: null,
  tags: [],
  addedAt: '2026-07-30T10:00:00+09:00' as PaperMeta['addedAt'],
})

function harness() {
  const root = mkdtempSync(join(tmpdir(), 'pct-register-'))
  const index = new IndexDb(join(root, 'index.sqlite'))
  const chunks = new ChunkStore(index.db)
  const deps = {
    dataDir: root,
    chunks,
    embed,
    model: { model: 'test', dimensions: 4 },
    indexPaper: (paper: Parameters<typeof index.upsertPaper>[0]) => index.upsertPaper(paper, true),
    markEmbedded: (slug: string) => index.markEmbeddingFresh(slug),
  }
  return { root, index, chunks, deps, close: () => (index.close(), rmSync(root, { recursive: true, force: true })) }
}

test('登録すると、埋め込みの作り直しが要る印が下りる', async () => {
  const h = harness()
  try {
    await writePaper(h.root, meta('kerbl2023-3dgs'), '# 1 Introduction\n\n本文の段落。')

    await registerPaper('kerbl2023-3dgs', h.deps)

    assert.deepEqual(h.index.staleEmbeddingSlugs(), [], '印が残ると、起動のたびに作り直しを積み直す')
    assert.ok(h.chunks.countChunks() > 0)
  } finally {
    h.close()
  }
})

test('本文が空でも印は下りる', async () => {
  const h = harness()
  try {
    await writePaper(h.root, meta('empty2023-paper'), '')

    await registerPaper('empty2023-paper', h.deps)

    assert.deepEqual(h.index.staleEmbeddingSlugs(), [])
    assert.equal(h.chunks.countChunks(), 0)
  } finally {
    h.close()
  }
})

test('本文が変わった論文は、作り直しが要るものとして挙がる', async () => {
  const h = harness()
  try {
    await writePaper(h.root, meta('kerbl2023-3dgs'), '# 1 Introduction\n\n本文の段落。')
    await registerPaper('kerbl2023-3dgs', h.deps)

    // 走査での読み直しに当たる。本文が変わったので作り直しが要る。
    h.index.upsertPaper({ meta: meta('kerbl2023-3dgs'), body: '別の本文', mtimeMs: 1, bodyHash: 'x' }, true)

    assert.deepEqual(h.index.staleEmbeddingSlugs(), ['kerbl2023-3dgs'])
  } finally {
    h.close()
  }
})
