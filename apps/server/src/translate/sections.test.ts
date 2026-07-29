import assert from 'node:assert/strict'
import { test } from 'node:test'
import { joinSections, splitSections } from './sections.ts'

test('見出しごとに分ける', () => {
  const s = splitSections('# 題\n\n本文 1\n\n## 節\n\n本文 2\n')
  assert.deepEqual(
    s.map((x) => x.heading),
    ['# 題', '## 節'],
  )
  assert.match(s[0]?.markdown ?? '', /本文 1/)
  assert.match(s[1]?.markdown ?? '', /本文 2/)
})

test('見出しは節の中に残る', () => {
  const s = splitSections('## 節\n\n本文\n')
  assert.ok(s[0]?.markdown.startsWith('## 節'))
})

test('見出しの深さを持つ', () => {
  const s = splitSections('# 一\n\na\n\n### 三\n\nb\n')
  assert.deepEqual(
    s.map((x) => x.level),
    [1, 3],
  )
})

test('見出しの前の文章も 1 つの節にする', () => {
  const s = splitSections('前書き\n\n# 題\n\n本文\n')
  assert.equal(s[0]?.level, 0)
  assert.equal(s[0]?.heading, '')
  assert.match(s[0]?.markdown ?? '', /前書き/)
})

test('コードブロックの中の # を見出しにしない', () => {
  // 擬似コードやシェルの例で行頭の # が注釈として現れる。
  const s = splitSections('# 題\n\n```sh\n# これは注釈\n```\n\n本文\n')
  assert.equal(s.length, 1)
  assert.match(s[0]?.markdown ?? '', /# これは注釈/)
})

test('波線のコードフェンスも同じに扱う', () => {
  const s = splitSections('# 題\n\n~~~\n# 注釈\n~~~\n')
  assert.equal(s.length, 1)
})

test('空の節は落とす', () => {
  const s = splitSections('\n\n\n')
  assert.deepEqual(s, [])
})

test('通し番号は 0 から連続する', () => {
  const s = splitSections('# a\n\n1\n\n# b\n\n2\n\n# c\n\n3\n')
  assert.deepEqual(
    s.map((x) => x.index),
    [0, 1, 2],
  )
})

test('訳した節を空行 1 つで連ねる', () => {
  assert.equal(joinSections(['# 題', '本文']), '# 題\n\n本文\n')
})

test('空の訳は連ねない', () => {
  assert.equal(joinSections(['a', '', '  ', 'b']), 'a\n\nb\n')
})
