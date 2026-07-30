import assert from 'node:assert/strict'
import { test } from 'node:test'
import { bodyBlocks, buildBody, pageIndex } from './document.ts'
import type { ConvertedBlock, ConvertedDocument, ConvertedFigure } from './types.ts'

const bbox = { x0: 0, y0: 0, x1: 1, y1: 1 }

function block(id: string, kind: ConvertedBlock['kind'], page: number, markdown: string): ConvertedBlock {
  return { id, kind, page, bbox, markdown, image: null, groupId: null }
}

function figure(blockId: string, page: number, image: string, caption: string): ConvertedFigure {
  return { blockId, page, image, caption }
}

function doc(blocks: ConvertedBlock[], figures: ConvertedFigure[] = []): ConvertedDocument {
  return { pageCount: 2, blocks, figures }
}

test('本文はページ順に連なる', () => {
  const d = doc([
    block('/page/1/Text/1', 'text', 1, '2 ページ目'),
    block('/page/0/Text/1', 'text', 0, '1 ページ目'),
  ])
  assert.deepEqual(
    bodyBlocks(d).map((b) => b.markdown),
    ['1 ページ目', '2 ページ目'],
  )
})

test('同じページの中は識別子の連番の順で、文字列としてではなく数として比べる', () => {
  const d = doc([
    block('/page/0/Text/21', 'text', 0, '後'),
    block('/page/0/Text/3', 'text', 0, '先'),
  ])
  assert.deepEqual(
    bodyBlocks(d).map((b) => b.markdown),
    ['先', '後'],
  )
})

test('キャプションを本文の地の文に混ぜない', () => {
  const d = doc([
    block('/page/0/Text/1', 'text', 0, '地の文'),
    block('/page/0/Caption/2', 'caption', 0, 'Fig. 1. 説明'),
  ])
  assert.deepEqual(
    bodyBlocks(d).map((b) => b.markdown),
    ['地の文'],
  )
})

test('ヘッダー・フッター・ページ番号は本文に入れない', () => {
  const d = doc([
    block('/page/0/PageHeader/1', 'pageHeader', 0, 'ACM Trans. Graph.'),
    block('/page/0/Text/2', 'text', 0, '地の文'),
    block('/page/0/PageFooter/3', 'pageFooter', 0, 'Publication date'),
    block('/page/0/PageNumber/4', 'pageNumber', 0, '102'),
  ])
  assert.deepEqual(
    bodyBlocks(d).map((b) => b.markdown),
    ['地の文'],
  )
})

test('図は画像とキャプションを組にして本文へ差し込む', () => {
  const d = doc(
    [block('/page/0/Text/1', 'text', 0, '地の文'), block('/page/1/Text/1', 'text', 1, '次のページ')],
    [figure('/page/0/Picture/2', 0, 'fig1.jpeg', 'Fig. 1. 説明')],
  )
  const body = buildBody(d, 'assets')
  assert.match(body, /<figure>/)
  assert.match(body, /!\[\]\(assets\/fig1\.jpeg\)/)
  assert.match(body, /<figcaption>\n\nFig\. 1\. 説明/)
  // 図はそのページの本文の後、次のページの本文の前に入る。
  assert.ok(body.indexOf('地の文') < body.indexOf('fig1.jpeg'))
  assert.ok(body.indexOf('fig1.jpeg') < body.indexOf('次のページ'))
})

test('キャプションの無い図は画像だけを差し込む', () => {
  const d = doc([block('/page/0/Text/1', 'text', 0, '地の文')], [figure('/page/0/Picture/2', 0, 'fig1.jpeg', '')])
  const body = buildBody(d, 'assets')
  assert.match(body, /!\[\]\(assets\/fig1\.jpeg\)/)
  assert.doesNotMatch(body, /<figure>/)
})

test('最後のページの図も落とさない', () => {
  const d = doc([block('/page/0/Text/1', 'text', 0, '地の文')], [figure('/page/3/Picture/1', 3, 'last.jpeg', '説明')])
  assert.match(buildBody(d, 'assets'), /last\.jpeg/)
})

test('本文が空でも図だけの markdown を返す', () => {
  const d = doc([], [figure('/page/0/Picture/1', 0, 'only.jpeg', '')])
  assert.match(buildBody(d, 'assets'), /only\.jpeg/)
})

test('ブロックの識別子からページを引ける', () => {
  const d = doc([block('/page/4/Text/1', 'text', 4, '本文')])
  assert.equal(pageIndex(d).get('/page/4/Text/1'), 4)
})

test('本文のブロックが無いページの図も落とさない', () => {
  // 全面が図のページには本文のブロックが無い。
  const d = doc(
    [block('/page/0/Text/1', 'text', 0, '1 ページ目'), block('/page/2/Text/1', 'text', 2, '3 ページ目')],
    [figure('/page/1/Picture/1', 1, 'fullpage.jpeg', 'Fig. 5. 全面の図')],
  )
  const body = buildBody(d, 'assets')
  assert.match(body, /fullpage\.jpeg/)
  assert.ok(body.indexOf('1 ページ目') < body.indexOf('fullpage.jpeg'))
  assert.ok(body.indexOf('fullpage.jpeg') < body.indexOf('3 ページ目'))
})

test('数式のブロックは $$ で囲む', () => {
  // 変換器は素の LaTeX を返す。区切りが無いと markdown として数式に見えず、
  // 翻訳の契約の検証も数式を見つけられない。
  const d = doc([block('/page/0/Equation/1', 'equation', 0, 'C = \\sum_{i=1}^N T_i')])
  assert.match(buildBody(d, 'assets'), /\$\$\nC = \\sum_\{i=1\}\^N T_i\n\$\$/)
})

test('既に囲まれている数式を二重に囲まない', () => {
  const d = doc([block('/page/0/Equation/1', 'equation', 0, '$$x = y$$')])
  assert.doesNotMatch(buildBody(d, 'assets'), /\$\$\$/)
})

test('環境で始まる数式はそのまま残す', () => {
  const d = doc([block('/page/0/Equation/1', 'equation', 0, '\\begin{aligned} a &= b \\end{aligned}')])
  const body = buildBody(d, 'assets')
  assert.doesNotMatch(body, /\$\$/)
  assert.match(body, /\\begin\{aligned\}/)
})

test('数式以外のブロックは囲まない', () => {
  const d = doc([block('/page/0/Text/1', 'text', 0, '本文')])
  assert.doesNotMatch(buildBody(d, 'assets'), /\$\$/)
})
