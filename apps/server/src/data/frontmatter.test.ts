import assert from 'node:assert/strict'
import { test } from 'node:test'
import { joinDocument, splitDocument } from './frontmatter.ts'

test('frontmatter と本文を切り分ける', () => {
  const { meta, body } = splitDocument('---\ntitle: NeRF\nyear: 2020\n---\n\n本文の 1 行目\n')
  assert.deepEqual(meta, { title: 'NeRF', year: 2020 })
  assert.equal(body, '本文の 1 行目\n')
})

test('frontmatter が無いファイルも読める', () => {
  const { meta, body } = splitDocument('# 見出し\n\n本文\n')
  assert.deepEqual(meta, {})
  assert.equal(body, '# 見出し\n\n本文\n')
})

test('閉じられていない frontmatter は本文として扱う', () => {
  const text = '---\ntitle: NeRF\n\n本文\n'
  assert.deepEqual(splitDocument(text).meta, {})
  assert.equal(splitDocument(text).body, text)
})

test('本文中の水平線を frontmatter の終わりと取り違えない', () => {
  const { meta, body } = splitDocument('---\ntitle: A\n---\n\n序文\n\n---\n\n続き\n')
  assert.deepEqual(meta, { title: 'A' })
  assert.equal(body, '序文\n\n---\n\n続き\n')
})

test('書き出して読み直すと同じ値になる', () => {
  const meta = { slug: 'mildenhall2020-nerf', tags: ['3d', 'rendering'], year: 2020, venue: null }
  const text = joinDocument({ meta, body: '本文\n' })
  const round = splitDocument(text)
  assert.deepEqual(round.meta, meta)
  assert.equal(round.body, '本文\n')
})

test('frontmatter が無いときは本文だけを書き出す', () => {
  assert.equal(joinDocument({ meta: {}, body: '本文' }), '本文\n')
})

test('YAML として配列やスカラーが来ても空のメタとして扱う', () => {
  assert.deepEqual(splitDocument('---\n- a\n- b\n---\n\n本文\n').meta, {})
  assert.deepEqual(splitDocument('---\njust a string\n---\n\n本文\n').meta, {})
})

test('日時を Date へ変換せず、書かれたオフセットのまま保つ', () => {
  const text = '---\ncreated: 2026-07-27T15:04:12+09:00\nadded_at: 2026-07-27\n---\n\n本文\n'
  const { meta } = splitDocument(text)
  assert.equal(meta['created'], '2026-07-27T15:04:12+09:00')
  assert.equal(meta['added_at'], '2026-07-27')
})

test('日時を含む frontmatter を書き戻しても値が変わらない', () => {
  const text = '---\ncreated: 2026-07-27T15:04:12+09:00\n---\n\n本文\n'
  const once = splitDocument(text)
  const twice = splitDocument(joinDocument(once))
  assert.deepEqual(twice.meta, once.meta)
  assert.equal(twice.body, once.body)
})
