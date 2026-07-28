import assert from 'node:assert/strict'
import { test } from 'node:test'
import { extractArxivId, isArxivUrl, lookupArxiv, parseArxivEntry } from './arxiv.ts'

// 実際に arXiv の API が返した応答を切り詰めたもの。
const ENTRY = `<?xml version='1.0' encoding='UTF-8'?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:arxiv="http://arxiv.org/schemas/atom">
  <title>arXiv Query: search_query=&amp;id_list=2003.08934</title>
  <entry>
    <id>http://arxiv.org/abs/2003.08934v2</id>
    <title>NeRF: Representing Scenes as Neural Radiance Fields for View Synthesis</title>
    <published>2020-03-19T17:57:23Z</published>
    <updated>2020-08-03T22:17:31Z</updated>
    <summary>We present a method that achieves state-of-the-art results.</summary>
    <author><name>Ben Mildenhall</name></author>
    <author><name>Pratul P. Srinivasan</name></author>
    <link href="https://arxiv.org/abs/2003.08934v2" rel="alternate" type="text/html"/>
    <link href="https://arxiv.org/pdf/2003.08934v2" rel="related" type="application/pdf" title="pdf"/>
    <arxiv:primary_category term="cs.CV"/>
  </entry>
</feed>`

test('arXiv の URL を見分ける', () => {
  assert.equal(isArxivUrl('https://arxiv.org/abs/2003.08934'), true)
  assert.equal(isArxivUrl('https://www.arxiv.org/pdf/2003.08934'), true)
  assert.equal(isArxivUrl('https://export.arxiv.org/abs/2003.08934'), true)
  assert.equal(isArxivUrl('https://openreview.net/forum?id=abc'), false)
  assert.equal(isArxivUrl('壊れた URL'), false)
})

test('識別子を版を除いて取り出す', () => {
  assert.equal(extractArxivId('https://arxiv.org/abs/2003.08934'), '2003.08934')
  assert.equal(extractArxivId('https://arxiv.org/abs/2003.08934v2'), '2003.08934')
  assert.equal(extractArxivId('https://arxiv.org/pdf/2003.08934v12'), '2003.08934')
  assert.equal(extractArxivId('2003.08934'), '2003.08934')
})

test('2007 年より前の形式の識別子も取り出す', () => {
  assert.equal(extractArxivId('https://arxiv.org/abs/math/0309136'), 'math/0309136')
  assert.equal(extractArxivId('https://arxiv.org/abs/cond-mat/0309136v1'), 'cond-mat/0309136')
})

test('識別子が無い URL では null になる', () => {
  assert.equal(extractArxivId('https://arxiv.org/list/cs.GR/recent'), null)
})

test('応答から書誌情報を取り出す', () => {
  const source = parseArxivEntry(ENTRY, '2003.08934')
  assert.ok(source !== null)
  assert.equal(source.title, 'NeRF: Representing Scenes as Neural Radiance Fields for View Synthesis')
  assert.deepEqual(source.authors, ['Ben Mildenhall', 'Pratul P. Srinivasan'])
  assert.equal(source.year, 2020)
  assert.equal(source.originalUrl, 'https://arxiv.org/pdf/2003.08934v2')
  assert.equal(source.kind, 'pdf')
  assert.equal(source.arxivId, '2003.08934')
  assert.equal(source.via, 'arxiv')
  assert.match(source.abstract ?? '', /^We present a method/)
})

test('feed のタイトルを論文のタイトルと取り違えない', () => {
  const source = parseArxivEntry(ENTRY, '2003.08934')
  assert.ok(source !== null)
  assert.equal(source.title.startsWith('arXiv Query'), false)
})

test('journal_ref が無ければ学会名は空になる', () => {
  const source = parseArxivEntry(ENTRY, '2003.08934')
  assert.equal(source?.venue, null)
})

test('entry が無い応答では null になる', () => {
  assert.equal(parseArxivEntry('<feed></feed>', '2003.08934'), null)
})

test('API が失敗したら null を返す', async () => {
  const result = await lookupArxiv('2003.08934', async () => ({
    ok: false,
    status: 503,
    text: async () => '',
  }))
  assert.equal(result, null)
})

test('HTTPS の API を叩く', async () => {
  let requested = ''
  await lookupArxiv('2003.08934', async (url) => {
    requested = url
    return { ok: true, status: 200, text: async () => ENTRY }
  })
  assert.match(requested, /^https:\/\/export\.arxiv\.org\/api\/query\?id_list=2003\.08934/)
})
