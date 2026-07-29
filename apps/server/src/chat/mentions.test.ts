import assert from 'node:assert/strict'
import { test } from 'node:test'
import { expandMentions, findMentions } from './mentions.ts'

const KNOWN = new Set(['kerbl2023-3dgs', 'wang2023-adaptive-shells'])
const known = (slug: string): boolean => KNOWN.has(slug)

test('発言に現れる slug を書かれた順に返す', () => {
  const found = findMentions('@wang2023-adaptive-shells と @kerbl2023-3dgs を比べたい')

  assert.deepEqual(found, ['wang2023-adaptive-shells', 'kerbl2023-3dgs'])
})

test('同じ slug は 1 度だけ返す', () => {
  assert.deepEqual(findMentions('@kerbl2023-3dgs は速い。@kerbl2023-3dgs の実装は'), ['kerbl2023-3dgs'])
})

test('エージェントへ渡すときは論文の場所を伴う形に展開する', () => {
  const expanded = expandMentions('@kerbl2023-3dgs の 3.2 節', '/data', known)

  assert.equal(expanded, '@kerbl2023-3dgs(/data/papers/kerbl2023-3dgs/) の 3.2 節')
})

test('コレクションに無い slug は展開せず、解決しないことを伝える', () => {
  const expanded = expandMentions('@nosuch-paper について', '/data', known)

  assert.equal(expanded, '@nosuch-paper(コレクションに無い) について')
})

test('展開は入力の中だけで、元の表記は変えない', () => {
  const text = '@kerbl2023-3dgs を読んで'

  expandMentions(text, '/data', known)

  assert.equal(text, '@kerbl2023-3dgs を読んで')
})
