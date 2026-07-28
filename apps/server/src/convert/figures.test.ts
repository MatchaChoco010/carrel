import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildFigures } from './figures.ts'
import type { ConvertedBlock } from './types.ts'

type Rect = { x0: number; y0: number; x1: number; y1: number }

function fig(id: string, page: number, bbox: Rect, image: string, groupId: string | null = null): ConvertedBlock {
  return { id, kind: 'figure', page, bbox, markdown: '', image, groupId }
}

function cap(id: string, page: number, bbox: Rect, markdown: string, groupId: string | null = null): ConvertedBlock {
  return { id, kind: 'caption', page, bbox, markdown, image: null, groupId }
}

const LEFT = { x0: 50, x1: 290 }
const RIGHT = { x0: 310, x1: 550 }

test('変換器がまとめた組をそのまま使う', () => {
  const figures = buildFigures([
    fig('/page/0/Picture/1', 0, { ...LEFT, y0: 60, y1: 200 }, 'a.jpeg', '/page/0/PictureGroup/9'),
    cap('/page/0/Caption/2', 0, { ...LEFT, y0: 210, y1: 240 }, 'Fig. 1. 説明', '/page/0/PictureGroup/9'),
  ])
  assert.equal(figures.length, 1)
  assert.equal(figures[0]?.caption, 'Fig. 1. 説明')
})

test('組が無い図は、すぐ下のキャプションと結びつける', () => {
  const figures = buildFigures([
    fig('/page/4/Diagram/1', 4, { ...LEFT, y0: 72, y1: 176 }, 'd.jpeg'),
    cap('/page/4/Caption/2', 4, { ...LEFT, y0: 182, y1: 213 }, 'Fig. 2. 説明'),
  ])
  assert.equal(figures[0]?.caption, 'Fig. 2. 説明')
})

test('遠すぎるキャプションは結びつけない', () => {
  const figures = buildFigures([
    fig('/page/9/Picture/1', 9, { ...LEFT, y0: 65, y1: 160 }, 'p.jpeg'),
    cap('/page/9/Caption/5', 9, { ...LEFT, y0: 620, y1: 645 }, 'Fig. 8. 別の図の説明'),
  ])
  assert.equal(figures[0]?.caption, '')
})

test('図の上にあるキャプションは結びつけない', () => {
  const figures = buildFigures([
    cap('/page/1/Caption/1', 1, { ...LEFT, y0: 60, y1: 90 }, '上の図の説明'),
    fig('/page/1/Picture/2', 1, { ...LEFT, y0: 100, y1: 300 }, 'p.jpeg'),
  ])
  assert.equal(figures[0]?.caption, '')
})

test('別の段のキャプションは結びつけない', () => {
  const figures = buildFigures([
    fig('/page/2/Picture/1', 2, { ...LEFT, y0: 60, y1: 200 }, 'p.jpeg'),
    cap('/page/2/Caption/2', 2, { ...RIGHT, y0: 210, y1: 240 }, '右の段の説明'),
  ])
  assert.equal(figures[0]?.caption, '')
})

test('他の図の内側にある小図はキャプションを持たない', () => {
  const figures = buildFigures([
    fig('/page/9/Picture/1', 9, { ...LEFT, y0: 65, y1: 277 }, 'outer.jpeg'),
    fig('/page/9/Picture/2', 9, { x0: 72, x1: 200, y0: 72, y1: 159 }, 'inner.jpeg'),
    cap('/page/9/Caption/5', 9, { ...LEFT, y0: 280, y1: 301 }, 'Fig. 7. 説明'),
  ])
  const inner = figures.find((f) => f.image === 'inner.jpeg')
  const outer = figures.find((f) => f.image === 'outer.jpeg')
  assert.equal(inner?.caption, '')
  assert.equal(outer?.caption, 'Fig. 7. 説明')
})

test('1 つのキャプションを 2 つの図で共有しない', () => {
  const figures = buildFigures([
    fig('/page/3/Picture/1', 3, { ...LEFT, y0: 60, y1: 150 }, 'a.jpeg'),
    fig('/page/3/Picture/2', 3, { ...LEFT, y0: 100, y1: 155 }, 'b.jpeg'),
    cap('/page/3/Caption/3', 3, { ...LEFT, y0: 160, y1: 190 }, 'Fig. 5. 説明'),
  ])
  assert.equal(figures.filter((f) => f.caption.length > 0).length, 1)
})

test('画像を持たないブロックは図として返さない', () => {
  const block: ConvertedBlock = {
    id: '/page/0/Picture/1',
    kind: 'figure',
    page: 0,
    bbox: { ...LEFT, y0: 0, y1: 10 },
    markdown: '',
    image: null,
    groupId: null,
  }
  assert.deepEqual(buildFigures([block]), [])
})

test('ページ順に並べて返す', () => {
  const figures = buildFigures([
    fig('/page/5/Picture/1', 5, { ...LEFT, y0: 60, y1: 100 }, 'b.jpeg'),
    fig('/page/1/Picture/1', 1, { ...LEFT, y0: 60, y1: 100 }, 'a.jpeg'),
  ])
  assert.deepEqual(
    figures.map((f) => f.image),
    ['a.jpeg', 'b.jpeg'],
  )
})

test('組が複数のキャプションを含むとき、位置で正しいほうを選ぶ', () => {
  // 変換器は 1 つの組に 2 つの図と 2 つのキャプションを入れることがある。
  const g = '/page/4/PictureGroup/422'
  const figures = buildFigures([
    fig('/page/4/Diagram/1', 4, { x0: 42, x1: 570, y0: 72, y1: 176 }, 'top.jpeg'),
    cap('/page/4/Caption/2', 4, { x0: 49, x1: 564, y0: 182, y1: 213 }, 'Fig. 2. 上の説明', g),
    fig('/page/4/Picture/3', 4, { x0: 39, x1: 303, y0: 220, y1: 330 }, 'bottom.jpeg', g),
    cap('/page/4/Caption/7', 4, { x0: 49, x1: 295, y0: 335, y1: 377 }, 'Fig. 3. 下の説明', g),
  ])
  assert.equal(figures.find((f) => f.image === 'top.jpeg')?.caption, 'Fig. 2. 上の説明')
  assert.equal(figures.find((f) => f.image === 'bottom.jpeg')?.caption, 'Fig. 3. 下の説明')
})

test('隙間の小さい組から確定するので、遠い図が近い図のキャプションを奪わない', () => {
  const figures = buildFigures([
    fig('/page/9/Picture/1', 9, { x0: 39, x1: 305, y0: 65, y1: 277 }, 'upper.jpeg'),
    cap('/page/9/Caption/5', 9, { x0: 49, x1: 295, y0: 280, y1: 301 }, 'Fig. 7. 上の説明'),
    fig('/page/9/Picture/7', 9, { x0: 40, x1: 304, y0: 307, y1: 622 }, 'lower.jpeg'),
    cap('/page/9/Caption/12', 9, { x0: 49, x1: 295, y0: 622, y1: 644 }, 'Fig. 8. 下の説明'),
  ])
  assert.equal(figures.find((f) => f.image === 'upper.jpeg')?.caption, 'Fig. 7. 上の説明')
  assert.equal(figures.find((f) => f.image === 'lower.jpeg')?.caption, 'Fig. 8. 下の説明')
})
