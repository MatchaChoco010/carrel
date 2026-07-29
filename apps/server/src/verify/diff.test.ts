import assert from 'node:assert/strict'
import { test } from 'node:test'
import { needsFocus, textGap } from './diff.ts'

test('同じ内容なら欠落は無い', () => {
  const gap = textGap('Fig. 1. rendering quality', 'Fig. 1. rendering quality')
  assert.equal(gap.lost, 0)
})

test('下部に伸びる字の脱落を捕まえる', () => {
  // 変換器が g・q・y を落とした場合。
  const gap = textGap('with quality that equals', 'with ualit that e uals')
  assert.ok(gap.lost > 0)
  assert.ok(gap.samples.includes('q'))
})

test('1 文字の変数名の欠落を捕まえる', () => {
  // 語を単位にすると見落とす。数式用の斜体は基本多言語面の外にある。
  const gap = textGap('Rasterize(𝑤, 𝑀, 𝑆)', 'Rasterize(�, �, �)')
  assert.equal(gap.lost, 3)
  // 数式用の字は普通の英字へ均して比べるので、報告も M になる。
  assert.ok(gap.samples.includes('M'))
})

test('読み順が変わっても欠落とはみなさない', () => {
  // 変換器は 2 段組みの読み順を直すので、並びの一致は求めない。
  const gap = textGap('左の段 右の段', '右の段 左の段')
  assert.equal(gap.lost, 0)
})

test('行末のハイフンによる分割の結合を欠落とみなさない', () => {
  const gap = textGap('render-\ning', 'rendering')
  assert.equal(gap.lost, 0)
})

test('変換結果に余分な文字があっても欠落にはしない', () => {
  const gap = textGap('本文', '本文と見出し')
  assert.equal(gap.lost, 0)
})

test('同じ文字が複数回欠けたら回数ぶん数える', () => {
  const gap = textGap('aaa', 'a')
  assert.equal(gap.lost, 2)
})

test('欠落が目立つかを割合で判定する', () => {
  assert.equal(needsFocus({ lost: 1, total: 1000, samples: [] }), false)
  assert.equal(needsFocus({ lost: 50, total: 1000, samples: [] }), true)
})

test('文字層が空なら目立つとはみなさない', () => {
  assert.equal(needsFocus({ lost: 0, total: 0, samples: [] }), false)
})
