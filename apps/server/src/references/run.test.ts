import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { writePaper, type PaperMeta } from '../data/paper.ts'
import { readReferences, writeReferences } from '../data/references.ts'
import { parseReferences } from './run.ts'

const ENTRY = {
  text: 'Laurent Belcour, et al. 2018. Integrating Clipped Spherical Harmonics Expansions. ACM TOG 37, 2.',
  title: 'Integrating Clipped Spherical Harmonics Expansions',
  authors: ['Laurent Belcour', 'Guofu Xie'],
  year: 2018,
  arxivId: null,
  doi: '10.1145/3015459',
  url: null,
  kind: 'paper',
}

test('応答を参考文献の並びに直す', () => {
  const references = parseReferences(JSON.stringify({ entries: [ENTRY] }))
  assert.deepEqual(references, [
    {
      text: ENTRY.text,
      title: ENTRY.title,
      authors: ENTRY.authors,
      year: 2018,
      arxivId: null,
      doi: '10.1145/3015459',
      url: null,
      kind: 'paper',
    },
  ])
})

test('原文が無い項目は落とす', () => {
  const references = parseReferences(JSON.stringify({ entries: [{ ...ENTRY, text: '' }, ENTRY] }))
  assert.equal(references?.length, 1)
})

test('題が無ければ原文で代える', () => {
  const references = parseReferences(JSON.stringify({ entries: [{ ...ENTRY, title: null }] }))
  assert.equal(references?.[0]?.title, ENTRY.text)
})

test('JSON として読めない応答は null になる', () => {
  assert.equal(parseReferences('参考文献は見つかりませんでした'), null)
  assert.equal(parseReferences(JSON.stringify({ entries: '1 件' })), null)
})

test('書いた参考文献をそのまま読み戻せる', async () => {
  const root = mkdtempSync(join(tmpdir(), 'carrel-references-'))
  try {
    const meta: PaperMeta = {
      slug: 'belcour2018-clipped-spherical-harmonics',
      title: 'A Paper',
      authors: [],
      venue: null,
      year: 2018,
      arxivId: null,
      sourceUrl: 'https://example.com/a',
      pdfUrl: null,
      tags: [],
      addedAt: '2026-07-31T10:00:00+09:00' as PaperMeta['addedAt'],
    }
    await writePaper(root, meta, '')

    const references = parseReferences(JSON.stringify({ entries: [ENTRY, { ...ENTRY, kind: 'other' }] }))
    assert.ok(references !== null)
    await writeReferences(root, meta.slug, references)

    const read = await readReferences(root, meta.slug)
    assert.equal(read?.slug, meta.slug)
    assert.deepEqual(read?.references, references)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('段階が走っていない論文の参考文献は null になる', async () => {
  const root = mkdtempSync(join(tmpdir(), 'carrel-references-'))
  try {
    assert.equal(await readReferences(root, 'nobody2020-nothing'), null)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
