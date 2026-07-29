import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildChunks, CHUNK_LIMIT } from './chunks.ts'

test('見出しごとにチャンクを切る', () => {
  const c = buildChunks('# 題\n\n本文 1\n\n## 節\n\n本文 2\n')
  assert.deepEqual(
    c.map((x) => x.text),
    ['本文 1', '本文 2'],
  )
})

test('見出し経路を持つ', () => {
  const c = buildChunks('# 3 手法\n\na\n\n## 3.1 最適化\n\nb\n')
  assert.deepEqual(
    c.map((x) => x.path),
    ['3 手法', '3 手法 > 3.1 最適化'],
  )
})

test('同じ深さの見出しは経路を置き換える', () => {
  const c = buildChunks('## A\n\na\n\n## B\n\nb\n')
  assert.deepEqual(
    c.map((x) => x.path),
    ['A', 'B'],
  )
})

test('浅い見出しへ戻ると深い経路を捨てる', () => {
  const c = buildChunks('# 1\n\na\n\n## 1.1\n\nb\n\n# 2\n\nc\n')
  assert.deepEqual(
    c.map((x) => x.path),
    ['1', '1 > 1.1', '2'],
  )
})

test('見出しの前の本文は経路を持たない', () => {
  const c = buildChunks('前書き\n\n# 題\n\n本文\n')
  assert.equal(c[0]?.path, '')
})

test('コードブロックの中の # を見出しにしない', () => {
  const c = buildChunks('# 題\n\n```sh\n# 注釈\n```\n\n本文\n')
  assert.equal(c.length, 1)
})

test('長い本文を上限で分割する', () => {
  const long = 'あ'.repeat(CHUNK_LIMIT * 2 + 100)
  const c = buildChunks(`# 題\n\n${long}\n`)
  assert.ok(c.length >= 2)
  for (const x of c) assert.ok(x.text.length <= CHUNK_LIMIT)
})

test('分割したチャンクは同じ見出し経路を持つ', () => {
  const long = 'あ'.repeat(CHUNK_LIMIT * 2)
  const c = buildChunks(`## 3.1 最適化\n\n${long}\n`)
  assert.ok(c.length >= 2)
  for (const x of c) assert.equal(x.path, '3.1 最適化')
})

test('分割したチャンクは隣と重なる', () => {
  const long = Array.from({ length: 40 }, (_, i) => `文${i}。`.repeat(20)).join('\n\n')
  const c = buildChunks(`# 題\n\n${long}\n`)
  assert.ok(c.length >= 2)
  const first = c[0]?.text ?? ''
  const second = c[1]?.text ?? ''
  const tail = first.slice(-40)
  assert.ok(second.includes(tail.slice(0, 20)) || first.length + second.length > long.length)
})

test('通し番号は 0 から連続する', () => {
  const c = buildChunks('# a\n\n1\n\n# b\n\n2\n')
  assert.deepEqual(
    c.map((x) => x.index),
    [0, 1],
  )
})

test('空の本文はチャンクを作らない', () => {
  assert.deepEqual(buildChunks('\n\n'), [])
})

test('見出しだけで本文の無い節はチャンクにしない', () => {
  const c = buildChunks('# 題\n\n## 空の節\n\n## 中身のある節\n\n本文\n')
  assert.deepEqual(
    c.map((x) => x.text),
    ['本文'],
  )
})
