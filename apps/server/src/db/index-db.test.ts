import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { IndexDb } from './index-db.ts'
import type { PaperMeta } from '../data/paper.ts'

function meta(slug: string, over: Partial<PaperMeta> = {}): PaperMeta {
  return {
    slug,
    title: 'A Paper',
    authors: ['Bernhard Kerbl', 'Georgios Kopanas'],
    venue: null,
    year: 2023,
    arxivId: null,
    doi: null,
    sourceUrl: `https://example.com/${slug}`,
    pdfUrl: null,
    tags: [],
    addedAt: '2026-07-30T10:00:00+09:00' as PaperMeta['addedAt'],
    ...over,
  }
}

function harness() {
  const root = mkdtempSync(join(tmpdir(), 'carrel-index-db-'))
  const index = new IndexDb(join(root, 'index.sqlite'))
  const put = (m: PaperMeta): void =>
    index.upsertPaper({ meta: m, body: '', mtimeMs: 0, bodyHash: 'x' } as Parameters<typeof index.upsertPaper>[0], true)
  return { index, put, close: () => (index.close(), rmSync(root, { recursive: true, force: true })) }
}

test('一覧は題と著者と年と追加日を返す(0024)', () => {
  const h = harness()
  try {
    h.put(meta('kerbl2023-3d-gaussian-splatting', { title: '3D Gaussian Splatting' }))
    const entries = h.index.slugIndex()
    assert.deepEqual(entries, [
      {
        slug: 'kerbl2023-3d-gaussian-splatting',
        title: '3D Gaussian Splatting',
        authors: ['Bernhard Kerbl', 'Georgios Kopanas'],
        year: 2023,
        addedAt: '2026-07-30T10:00:00+09:00',
      },
    ])
  } finally {
    h.close()
  }
})

test('一覧は取り込んだ順に並ぶ(0024)', () => {
  const h = harness()
  try {
    h.put(meta('wang2026-restir-g-pt', { addedAt: '2026-07-31T09:00:00+09:00' as PaperMeta['addedAt'] }))
    h.put(meta('wang2026-himat', { addedAt: '2026-07-30T09:00:00+09:00' as PaperMeta['addedAt'] }))
    assert.deepEqual(
      h.index.slugIndex().map((entry) => entry.slug),
      ['wang2026-himat', 'wang2026-restir-g-pt'],
    )
  } finally {
    h.close()
  }
})

test('著者の並びは論文の並びのまま返る(0024)', () => {
  const h = harness()
  try {
    h.put(meta('a2020-x', { authors: ['Zed Last', 'Amy First'] }))
    assert.deepEqual(h.index.slugIndex()[0]?.authors, ['Zed Last', 'Amy First'])
  } finally {
    h.close()
  }
})
