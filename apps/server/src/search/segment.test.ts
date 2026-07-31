import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildSegmenter } from './segment.ts'

const segment = await buildSegmenter()

test('日本語を語に割る', () => {
  assert.equal(segment('球面調和関数を用いた照明'), '球面 調和 関数 を 用いる た 照明')
})

test('活用する語は基本形に直す', () => {
  assert.equal(segment('散乱した'), '散乱 する た')
  assert.equal(segment('近似される'), '近似 する れる')
})

test('英語はそのまま語に割れる', () => {
  assert.equal(segment('state of the art'), 'state of the art')
})

test('空の入力は空になる', () => {
  assert.equal(segment(''), '')
  assert.equal(segment('   \n  '), '')
})
