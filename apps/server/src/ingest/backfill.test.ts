import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { writePaper, type PaperMeta } from '../data/paper.ts'
import { StateDb } from '../db/state-db.ts'
import { backfillIngestMetadata } from './pipeline.ts'
import { IngestStore } from './store.ts'

function meta(slug: string, over: Partial<PaperMeta> = {}): PaperMeta {
  return {
    slug,
    title: 'Component Modes Synthesis Method with Multiple Partitions',
    authors: ['Yun Zhao'],
    venue: null,
    year: 2026,
    arxivId: null,
    doi: '10.1145/3811279',
    sourceUrl: 'Component Modes Synthesis Method with Multiple Partitions',
    pdfUrl: null,
    tags: [],
    addedAt: '2026-08-01T16:04:00+09:00' as PaperMeta['addedAt'],
    ...over,
  }
}

function harness() {
  const root = mkdtempSync(join(tmpdir(), 'carrel-backfill-'))
  const state = new StateDb(join(root, 'state.sqlite'))
  const ingests = new IngestStore(state.db)
  const dataDir = join(root, 'data')
  return { dataDir, ingests, close: () => (state.close(), rmSync(root, { recursive: true, force: true })) }
}

test('失敗した取り込みの記録に、論文の題と DOI を入れる(#271)', async () => {
  const h = harness()
  try {
    await writePaper(h.dataDir, meta('zhao2026-component-modes'), '')
    h.ingests.start({ slug: 'zhao2026-component-modes', sourceUrl: '題名', arxivId: null, originalUrl: null })
    h.ingests.fail('zhao2026-component-modes', '原本を取得できなかった')

    assert.equal(await backfillIngestMetadata(h.dataDir, h.ingests), 1)
    const record = h.ingests.get('zhao2026-component-modes')
    assert.equal(record?.title, 'Component Modes Synthesis Method with Multiple Partitions')
    assert.equal(record?.doi, '10.1145/3811279')
  } finally {
    h.close()
  }
})

test('論文を持たない取り込みは、そのままにする(#271)', async () => {
  const h = harness()
  try {
    h.ingests.start({ slug: 'unknown0000-abcd', sourceUrl: '題名', arxivId: null, originalUrl: null })
    h.ingests.fail('unknown0000-abcd', '解決に失敗した')

    assert.equal(await backfillIngestMetadata(h.dataDir, h.ingests), 0)
    assert.equal(h.ingests.get('unknown0000-abcd')?.title, null)
  } finally {
    h.close()
  }
})

test('二度目は何もしない(#271)', async () => {
  const h = harness()
  try {
    await writePaper(h.dataDir, meta('zhao2026-component-modes'), '')
    h.ingests.start({ slug: 'zhao2026-component-modes', sourceUrl: '題名', arxivId: null, originalUrl: null })
    h.ingests.fail('zhao2026-component-modes', '原本を取得できなかった')

    assert.equal(await backfillIngestMetadata(h.dataDir, h.ingests), 1)
    assert.equal(await backfillIngestMetadata(h.dataDir, h.ingests), 0)
  } finally {
    h.close()
  }
})
