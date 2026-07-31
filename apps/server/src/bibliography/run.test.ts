import assert from 'node:assert/strict'
import test from 'node:test'
import type { PaperMeta } from '../data/paper.ts'
import { mergeBibliography, parseBibliography } from './run.ts'

const META: PaperMeta = {
  slug: 'sun2026-minimal-surfaces',
  title: 'Neural Representation of Minimal Surfaces',
  authors: ['Sun'],
  venue: null,
  year: 2026,
  arxivId: '2607.23437',
  doi: null,
  sourceUrl: 'https://arxiv.org/abs/2607.23437',
  pdfUrl: 'https://arxiv.org/pdf/2607.23437',
  tags: ['rendering'],
  addedAt: '2026-07-31 10:00:00',
}

test('確かめた書誌を読む', () => {
  const found = parseBibliography(
    JSON.stringify({
      title: '8DNA: 8D Neural Asset Light Transport by Distribution Learning',
      authors: ['Wu', 'Zhao'],
      venue: 'SIGGRAPH 2026 Conference Papers',
      year: 2026,
      doi: 'https://doi.org/10.1145/3799902.3811094',
      arxivId: null,
      pdfUrl: 'https://example.org/paper.pdf',
      pageUrl: 'https://dl.acm.org/doi/10.1145/3799902.3811094',
    }),
  )
  assert.deepEqual(found, {
    title: '8DNA: 8D Neural Asset Light Transport by Distribution Learning',
    authors: ['Wu', 'Zhao'],
    venue: 'SIGGRAPH 2026 Conference Papers',
    year: 2026,
    doi: '10.1145/3799902.3811094',
    arxivId: null,
    pdfUrl: 'https://example.org/paper.pdf',
  })
})

test('プレプリントの投稿先は学会名として採らない', () => {
  const found = parseBibliography(
    JSON.stringify({ title: null, authors: [], venue: 'arXiv preprint', year: 2026, doi: null, arxivId: null, pdfUrl: null, pageUrl: null }),
  )
  assert.equal(found?.venue, null)
})

test('DOI として読めない値は落とす', () => {
  const found = parseBibliography(
    JSON.stringify({ title: null, authors: [], venue: null, year: null, doi: '見つからなかった', arxivId: null, pdfUrl: null, pageUrl: null }),
  )
  assert.equal(found?.doi, null)
})

test('URL でない所在は採らない', () => {
  const found = parseBibliography(
    JSON.stringify({ title: null, authors: [], venue: null, year: null, doi: null, arxivId: null, pdfUrl: 'ACM のページ', pageUrl: null }),
  )
  assert.equal(found?.pdfUrl, null)
})

test('arXiv の識別子は URL で返っても取り出す', () => {
  const found = parseBibliography(
    JSON.stringify({
      title: null,
      authors: [],
      venue: null,
      year: null,
      doi: null,
      arxivId: 'https://arxiv.org/abs/2607.23437',
      pdfUrl: null,
      pageUrl: null,
    }),
  )
  assert.equal(found?.arxivId, '2607.23437')
})

test('JSON として読めない応答は null を返す', () => {
  assert.equal(parseBibliography('見つかりませんでした'), null)
})

test('確かめた項目だけを入れ替える', () => {
  const merged = mergeBibliography(META, {
    title: null,
    authors: [],
    venue: 'ACM Transactions on Graphics',
    year: null,
    doi: '10.1145/3799902.3811094',
    arxivId: null,
    pdfUrl: null,
  })
  assert.equal(merged.venue, 'ACM Transactions on Graphics')
  assert.equal(merged.doi, '10.1145/3799902.3811094')
  // 確かめられなかった項目は、いまの値のまま残す。
  assert.equal(merged.year, 2026)
  assert.equal(merged.arxivId, '2607.23437')
  assert.equal(merged.pdfUrl, 'https://arxiv.org/pdf/2607.23437')
})

test('本文から読み取った標題と著者で置き換える', () => {
  const merged = mergeBibliography(META, {
    title: 'Neural Representations of Minimal Surfaces',
    authors: ['Xingyu Sun', 'Amir Vaxman'],
    venue: null,
    year: null,
    doi: null,
    arxivId: null,
    pdfUrl: null,
  })
  assert.equal(merged.title, 'Neural Representations of Minimal Surfaces')
  assert.deepEqual(merged.authors, ['Xingyu Sun', 'Amir Vaxman'])
})

test('slug とタグと出所の URL は変えない', () => {
  const merged = mergeBibliography(META, {
    title: null,
    authors: [],
    venue: 'SIGGRAPH Asia 2026',
    year: 2027,
    doi: '10.1145/1',
    arxivId: '9999.99999',
    pdfUrl: 'https://example.org/other.pdf',
  })
  assert.equal(merged.slug, META.slug)
  assert.deepEqual(merged.tags, META.tags)
  assert.equal(merged.sourceUrl, META.sourceUrl)
  assert.equal(merged.addedAt, META.addedAt)
  assert.equal(merged.title, META.title)
  assert.deepEqual(merged.authors, META.authors)
})
