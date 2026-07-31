import assert from 'node:assert/strict'
import test from 'node:test'
import { completeSlug, slugTokenAt } from './slug-token.ts'

test('末尾の書き掛けを取り出す', () => {
  const value = 'この論文 @bel'
  assert.deepEqual(slugTokenAt(value, value.length), { text: 'bel', start: 5, end: value.length })
})

test('本文の途中でも取り出す', () => {
  const value = 'この @bel と比べたい'
  const caret = value.indexOf(' と比べたい')
  assert.deepEqual(slugTokenAt(value, caret), { text: 'bel', start: 3, end: caret })
})

test('打ち始めの @ だけでも出す', () => {
  const value = '@'
  assert.deepEqual(slugTokenAt(value, 1), { text: '', start: 0, end: 1 })
})

test('改行の後の @ も出す', () => {
  const value = '前の行\n@iwa'
  assert.equal(slugTokenAt(value, value.length)?.text, 'iwa')
})

test('語の途中の @ では出さない', () => {
  const value = 'mail@example'
  assert.equal(slugTokenAt(value, value.length), null)
})

test('カーソルの後ろが語の続きなら出さない', () => {
  const value = '@bel と比べたい'
  assert.equal(slugTokenAt(value, 2), null)
})

test('@ より前にカーソルがあれば出さない', () => {
  const value = 'この @bel'
  assert.equal(slugTokenAt(value, 2), null)
})

test('slug に使えない文字を挟むと出さない', () => {
  const value = '@bel cour'
  assert.equal(slugTokenAt(value, value.length), null)
})

test('書き掛けを選んだ slug で置き換える', () => {
  const value = 'この @bel と比べたい'
  const caret = value.indexOf(' と比べたい')
  const token = slugTokenAt(value, caret)
  assert.notEqual(token, null)
  assert.deepEqual(completeSlug(value, token as never, 'belcour2018-clipped'), {
    value: 'この @belcour2018-clipped  と比べたい',
    caret: 3 + '@belcour2018-clipped '.length,
  })
})

test('末尾で置き換えると、その後ろにカーソルが来る', () => {
  const value = '@iwa'
  const token = slugTokenAt(value, value.length)
  const done = completeSlug(value, token as never, 'iwasaki2025-sh')
  assert.equal(done.value, '@iwasaki2025-sh ')
  assert.equal(done.caret, done.value.length)
})
