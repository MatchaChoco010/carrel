import assert from 'node:assert/strict'
import { test } from 'node:test'
import { defaultConfig, mergeConfig } from './config.ts'

test('空の設定は既定値になる', () => {
  assert.deepEqual(mergeConfig({}), defaultConfig)
  assert.deepEqual(mergeConfig(null), defaultConfig)
  assert.deepEqual(mergeConfig('壊れた値'), defaultConfig)
})

test('書かれたキーだけを既定値の上に重ねる', () => {
  const merged = mergeConfig({ arxiv: { categories: ['cs.GR', 'cs.CV'] } })
  assert.deepEqual(merged.arxiv.categories, ['cs.GR', 'cs.CV'])
  assert.equal(merged.arxiv.fetchIntervalMinutes, defaultConfig.arxiv.fetchIntervalMinutes)
  assert.equal(merged.server.port, defaultConfig.server.port)
})

test('範囲の外れた値は既定値のまま残す', () => {
  assert.equal(mergeConfig({ server: { port: 0 } }).server.port, defaultConfig.server.port)
  assert.equal(mergeConfig({ server: { port: 70000 } }).server.port, defaultConfig.server.port)
  assert.equal(mergeConfig({ server: { port: 'abc' } }).server.port, defaultConfig.server.port)
  assert.equal(
    mergeConfig({ arxiv: { fetchIntervalMinutes: -1 } }).arxiv.fetchIntervalMinutes,
    defaultConfig.arxiv.fetchIntervalMinutes,
  )
})

test('未知のキーは捨てる', () => {
  const merged = mergeConfig({ unknownKey: 'x', dataDir: '/mnt/nas/pct' })
  assert.equal(merged.dataDir, '/mnt/nas/pct')
  assert.equal('unknownKey' in merged, false)
})

test('カテゴリの配列から文字列でない要素を落とす', () => {
  assert.deepEqual(mergeConfig({ arxiv: { categories: ['cs.GR', 42, '', null] } }).arxiv.categories, ['cs.GR'])
})

test('既定値を書き換えない', () => {
  const merged = mergeConfig({ arxiv: { categories: ['cs.CV'] } })
  merged.arxiv.categories.push('cs.LG')
  assert.deepEqual(defaultConfig.arxiv.categories, ['cs.GR'])
})
