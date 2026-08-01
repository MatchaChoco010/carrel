import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { Collection } from '../data/collection.ts'
import { writePaper, type PaperMeta } from '../data/paper.ts'
import { IndexDb } from '../db/index-db.ts'
import { StateDb } from '../db/state-db.ts'
import { IngestStore } from './store.ts'

function harness() {
  const root = mkdtempSync(join(tmpdir(), 'pct-ingest-'))
  const state = new StateDb(join(root, 'state.sqlite'))
  const index = new IndexDb(join(root, 'index.sqlite'))
  const ingests = new IngestStore(state.db)
  const dataDir = join(root, 'data')
  const collection = new Collection(dataDir, index, {}, () => ingests.incompleteSlugs())
  return {
    dataDir,
    index,
    ingests,
    collection,
    close: () => {
      state.close()
      index.close()
      rmSync(root, { recursive: true, force: true })
    },
  }
}

const meta = (slug: string): PaperMeta => ({
  slug,
  title: 'T',
  authors: ['A B'],
  venue: null,
  year: 2020,
  arxivId: '2003.08934',
  sourceUrl: 'https://arxiv.org/abs/2003.08934',
  pdfUrl: 'https://arxiv.org/pdf/2003.08934',
  tags: [],
  addedAt: '2026-07-28T12:00:00+09:00' as PaperMeta['addedAt'],
})

test('取り込みの開始を記録し、識別子と URL の両方から引ける', () => {
  const h = harness()
  try {
    h.ingests.start({
      slug: 'a2020-x',
      sourceUrl: 'https://arxiv.org/abs/2003.08934',
      arxivId: '2003.08934',
      originalUrl: 'https://arxiv.org/pdf/2003.08934',
    })
    assert.equal(h.ingests.byArxivId('2003.08934')?.slug, 'a2020-x')
    assert.equal(h.ingests.bySourceUrl('https://arxiv.org/abs/2003.08934')?.slug, 'a2020-x')
    assert.equal(h.ingests.bySourceUrl('https://arxiv.org/pdf/2003.08934')?.slug, 'a2020-x')
    assert.equal(h.ingests.get('a2020-x')?.status, 'inProgress')
  } finally {
    h.close()
  }
})

test('取り込みの途中の論文は索引へ載らない', async () => {
  const h = harness()
  try {
    await h.collection.ensureDirs()
    h.ingests.start({ slug: 'a2020-x', sourceUrl: 'u', arxivId: null, originalUrl: null })
    await writePaper(h.dataDir, meta('a2020-x'), '本文\n')

    const result = await h.collection.scan()
    assert.equal(result.papersIndexed, 0)
    assert.equal(h.index.countPapers(), 0)
  } finally {
    h.close()
  }
})

test('全段階が終わってから索引へ載る', async () => {
  const h = harness()
  try {
    await h.collection.ensureDirs()
    h.ingests.start({ slug: 'a2020-x', sourceUrl: 'u', arxivId: null, originalUrl: null })
    await writePaper(h.dataDir, meta('a2020-x'), '本文\n')
    await h.collection.scan()
    assert.equal(h.index.countPapers(), 0)

    h.ingests.finish('a2020-x')
    const result = await h.collection.scan()
    assert.equal(result.papersIndexed, 1)
    assert.equal(h.index.countPapers(), 1)
  } finally {
    h.close()
  }
})

test('取り込みの記録が無い論文は、外部から置かれた完成品として索引へ載る', async () => {
  const h = harness()
  try {
    await h.collection.ensureDirs()
    await writePaper(h.dataDir, meta('handplaced2020-x'), '本文\n')

    const result = await h.collection.scan()
    assert.equal(result.papersIndexed, 1)
    assert.equal(h.index.countPapers(), 1)
  } finally {
    h.close()
  }
})

test('索引に載った後で取り込みが失敗に落ちたら、索引から外す', async () => {
  const h = harness()
  try {
    await h.collection.ensureDirs()
    await writePaper(h.dataDir, meta('a2020-x'), '本文\n')
    await h.collection.scan()
    assert.equal(h.index.countPapers(), 1)

    h.ingests.start({ slug: 'a2020-x', sourceUrl: 'u', arxivId: null, originalUrl: null })
    await writePaper(h.dataDir, meta('a2020-x'), '本文を書き換えた\n')
    await h.collection.scan()
    assert.equal(h.index.countPapers(), 0)
  } finally {
    h.close()
  }
})

test('失敗した取り込みも、まだ完了していないものとして扱う', () => {
  const h = harness()
  try {
    h.ingests.start({ slug: 'a2020-x', sourceUrl: 'u', arxivId: null, originalUrl: null })
    h.ingests.fail('a2020-x', '取得できなかった')
    assert.deepEqual([...h.ingests.incompleteSlugs()], ['a2020-x'])
    assert.equal(h.ingests.get('a2020-x')?.lastError, '取得できなかった')
  } finally {
    h.close()
  }
})

test('取り込みを取り消すと記録が消える', () => {
  const h = harness()
  try {
    h.ingests.start({ slug: 'a2020-x', sourceUrl: 'u', arxivId: null, originalUrl: null })
    h.ingests.remove('a2020-x')
    assert.equal(h.ingests.get('a2020-x'), null)
    assert.equal(h.ingests.incompleteSlugs().size, 0)
  } finally {
    h.close()
  }
})

test('登録まで進んでいない取り込みは、題と DOI で引ける(#263)', () => {
  const h = harness()
  try {
    h.ingests.start({
      slug: 'olajos2026-clouds',
      sourceUrl: 'Environmental Volumetric Neural Shading of Clouds',
      arxivId: null,
      originalUrl: 'https://dl.acm.org/doi/pdf/10.1145/3820020',
      title: 'Environmental Volumetric Neural Shading of Clouds for Real-Time Rendering',
      doi: '10.1145/3820020',
    })
    h.ingests.fail('olajos2026-clouds', '変換が異常終了した')

    assert.deepEqual(h.ingests.pendingIdentities(), [
      {
        slug: 'olajos2026-clouds',
        title: 'Environmental Volumetric Neural Shading of Clouds for Real-Time Rendering',
        authors: [],
        doi: '10.1145/3820020',
        arxivId: null,
      },
    ])
  } finally {
    h.close()
  }
})

test('登録まで進んだ取り込みは、突き合わせの相手にしない(#263)', () => {
  const h = harness()
  try {
    h.ingests.start({ slug: 'a2020-x', sourceUrl: 'u', arxivId: null, originalUrl: null, title: 'T', doi: null })
    h.ingests.finish('a2020-x')
    assert.deepEqual(h.ingests.pendingIdentities(), [])
  } finally {
    h.close()
  }
})

test('題を持たない取り込みは、突き合わせの相手にしない(#263)', () => {
  const h = harness()
  try {
    h.ingests.start({ slug: 'a2020-x', sourceUrl: 'u', arxivId: null, originalUrl: null })
    assert.deepEqual(h.ingests.pendingIdentities(), [])
  } finally {
    h.close()
  }
})

test('題を持たない記録だけを、埋め直しの対象にする(#271)', () => {
  const h = harness()
  try {
    h.ingests.start({ slug: 'a2020-x', sourceUrl: 'u1', arxivId: null, originalUrl: null })
    h.ingests.fail('a2020-x', '取得に失敗した')
    h.ingests.start({ slug: 'b2020-y', sourceUrl: 'u2', arxivId: null, originalUrl: null, title: 'T', doi: null })
    h.ingests.fail('b2020-y', '取得に失敗した')
    h.ingests.start({ slug: 'c2020-z', sourceUrl: 'u3', arxivId: null, originalUrl: null })
    h.ingests.finish('c2020-z')

    // 題を持つものと、登録まで進んだものは外れる。
    assert.deepEqual(h.ingests.missingMetadata(), ['a2020-x'])

    h.ingests.setMetadata('a2020-x', 'A Paper', '10.1145/3811279')
    assert.deepEqual(h.ingests.missingMetadata(), [])
    assert.deepEqual(h.ingests.pendingIdentities(), [
      { slug: 'a2020-x', title: 'A Paper', authors: [], doi: '10.1145/3811279', arxivId: null },
      { slug: 'b2020-y', title: 'T', authors: [], doi: null, arxivId: null },
    ])
  } finally {
    h.close()
  }
})

test('失敗したら、走っていた段階を閉じる(#280)', () => {
  const h = harness()
  try {
    h.ingests.start({ slug: 'a2020-x', sourceUrl: 'u', arxivId: null, originalUrl: null })
    h.ingests.advance('a2020-x', 'fetch')
    h.ingests.fail('a2020-x', '原本を取得できなかった')

    const open = h.ingests.stages('a2020-x').filter((s) => s.finishedAt === null)
    assert.deepEqual(open, [])
  } finally {
    h.close()
  }
})

test('やり直すときは、開いたままの段階を閉じてから始める(#280)', () => {
  const h = harness()
  try {
    h.ingests.start({ slug: 'a2020-x', sourceUrl: 'u', arxivId: null, originalUrl: null })
    h.ingests.advance('a2020-x', 'fetch')
    h.ingests.fail('a2020-x', '取得に失敗した')
    h.ingests.resume('a2020-x', 'convert')

    // やり直した段階だけが開いている。
    assert.deepEqual(
      h.ingests.stages('a2020-x').filter((s) => s.finishedAt === null).map((s) => s.stage),
      ['convert'],
    )
  } finally {
    h.close()
  }
})

test('終わったら、飛ばした段階も閉じる(#280)', () => {
  const h = harness()
  try {
    h.ingests.start({ slug: 'a2020-x', sourceUrl: 'u', arxivId: null, originalUrl: null })
    // 照合を飛ばす経路(0022)を真似て、開いたままの段階を残す。
    h.ingests.startStage('a2020-x', 'verify')
    h.ingests.advance('a2020-x', 'register')
    h.ingests.finish('a2020-x')

    assert.deepEqual(h.ingests.stages('a2020-x').filter((s) => s.finishedAt === null), [])
  } finally {
    h.close()
  }
})
