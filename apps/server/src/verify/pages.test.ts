import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ConvertedBlock, ConvertedDocument } from '../convert/types.ts'
import { buildPageWork } from './pages.ts'
import type { TextLayer } from './textlayer.ts'

const bbox = { x0: 0, y0: 0, x1: 100, y1: 20 }

function block(id: string, page: number, markdown: string): ConvertedBlock {
  return { id, kind: 'text', page, bbox, markdown, image: null, groupId: null }
}

function doc(blocks: ConvertedBlock[], pageCount = 2): ConvertedDocument {
  return { pageCount, blocks, figures: [] }
}

function layer(pages: string[], regions: Record<string, string>): TextLayer {
  return { pages, regions: new Map(Object.entries(regions)) }
}

test('ページごとに 1 つの要求を作る', () => {
  const work = buildPageWork(doc([block('/page/0/Text/1', 0, '本文')], 3), layer(['a', 'b', 'c'], {}))
  assert.deepEqual(
    work.map((w) => w.page),
    [0, 1, 2],
  )
})

test('文字層はブロックの領域から引いたものを連ねる', () => {
  const work = buildPageWork(
    doc([block('/page/0/Text/1', 0, '前半'), block('/page/0/Text/2', 0, '後半')]),
    layer(['ページ全体'], { '/page/0/Text/1': '前半の文字層', '/page/0/Text/2': '後半の文字層' }),
  )
  assert.equal(work[0]?.input.textLayer, '前半の文字層\n\n後半の文字層')
})

test('領域で引けないブロックがあればページ全体を添える', () => {
  const work = buildPageWork(
    doc([block('/page/0/Text/1', 0, '前半'), block('/page/0/Text/2', 0, '後半')]),
    layer(['ページ全体の文字層'], { '/page/0/Text/1': '前半の文字層' }),
  )
  assert.equal(work[0]?.input.textLayer, 'ページ全体の文字層')
})

test('本文のブロックが無いページにもページ全体の文字層を渡す', () => {
  const work = buildPageWork(doc([block('/page/1/Text/1', 1, '本文')]), layer(['図だけのページ', 'x'], {}))
  assert.equal(work[0]?.input.converted, '')
  assert.equal(work[0]?.input.textLayer, '図だけのページ')
})

test('文字を出せなかった印があれば重点的に見る対象にする', () => {
  const work = buildPageWork(
    doc([block('/page/0/Text/1', 0, 'Rasterize(�, �, �)')]),
    layer(['Rasterize(𝑤, 𝑀, 𝑆)'], { '/page/0/Text/1': 'Rasterize(𝑤, 𝑀, 𝑆)' }),
  )
  assert.equal(work[0]?.input.focus, true)
  assert.ok(work[0]?.input.missingSamples.includes('M'))
})

test('欠落の無いページには注意を付けない', () => {
  const work = buildPageWork(
    doc([block('/page/0/Text/1', 0, '同じ本文')]),
    layer([''], { '/page/0/Text/1': '同じ本文' }),
  )
  assert.equal(work[0]?.input.focus, false)
})

test('欠落はページ全体で測る', () => {
  // ブロックごとに測ると、領域が自分の内容より広いブロックで差が実体なく
  // 膨らむ。ページ全体なら紙面の文字が両側で 1 回ずつ数えられる。
  const work = buildPageWork(doc([block('/page/0/Text/1', 0, 'ab')]), layer(['abc'], {}))
  assert.equal(work[0]?.gap.lost, 1)
})

test('欠落が僅かでも、文字を出せなかった印があれば見落とさない', () => {
  // 割合だけで判定すると、長いページに紛れた僅かな欠落が薄まって消える。
  const long = 'あ'.repeat(2000)
  const work = buildPageWork(
    doc([block('/page/0/Text/1', 0, `${long}Rasterize(�, �, �)`)]),
    layer([`${long}Rasterize(𝑤, 𝑀, 𝑆)`], {}),
  )
  assert.equal(work[0]?.input.focus, true)
})

test('欠落が僅かで印も無ければ重点的に見る対象にしない', () => {
  const long = 'あ'.repeat(2000)
  const work = buildPageWork(doc([block('/page/0/Text/1', 0, long)]), layer([`${long}x`], {}))
  assert.equal(work[0]?.input.focus, false)
})

test('照合に渡す markdown には図の参照が含まれる', () => {
  const document: ConvertedDocument = {
    pageCount: 1,
    blocks: [{ id: '/page/0/Text/1', kind: 'text', page: 0, bbox, markdown: '本文', image: null, groupId: null }],
    figures: [{ blockId: '/page/0/Figure/2', page: 0, image: 'page-0-Figure-2.jpeg', caption: 'Fig. 1' }],
  }
  const layer: TextLayer = { pages: ['本文'], regions: new Map([['/page/0/Text/1', '本文']]) }

  const work = buildPageWork(document, layer, 'assets')

  assert.match(work[0]?.input.converted ?? '', /!\[\]\(assets\/page-0-Figure-2\.jpeg\)/)
})
